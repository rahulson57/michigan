/**
 * EditorPage — /write (new story) and /write/:id (resume one).
 *
 * Composition surface: cover image, title, subtitle, tags, then the RichEditor.
 * The draft autosaves ~1.5s after you stop typing (POST /api/articles the first
 * time, PUT /api/articles/:id after that) and publishing hands off to
 * /article/:slug.
 *
 * Four notes worth keeping in mind if you touch this file:
 *
 * 1. AUTH (DEC-146). useAuth() exposes `loading`. Nothing loads, saves or
 *    redirects until hydration finishes, so refreshing /write/:id while signed
 *    in does not bounce the writer to /login or autosave an empty document over
 *    a real one.
 *
 * 2. LOADING BY ID. The articles API reads by SLUG (GET /api/articles/:slug) and
 *    has no by-id route, so `/write/:id` resolves the id → slug through the
 *    author's own lists (GET /api/articles/me/drafts, then
 *    GET /api/articles?author=…) and then fetches the full article. Cheap, and
 *    it needs no server change — server/routes/articles.js is owned by T1.
 *
 * 3. SESSIONS AND GENERATIONS — the part that keeps drafts from eating each
 *    other. /write and /write/:id are SIBLING routes rendering the same element,
 *    so moving between them RECONCILES rather than remounts: every ref below
 *    survives, including one belonging to a PUT that is still in flight. The
 *    document currently in the form is therefore identified by `sessionRef`
 *    ('new' or the article id) and stamped with a monotonic `genRef`. Every
 *    reset or load calls beginSession(), which bumps the generation and
 *    abandons the timers and the save mutex. EVERY write-back that happens
 *    after an `await` re-checks its captured generation first, so a save that
 *    outlives its session can neither resurrect the old article id nor overwrite
 *    the new story's baseline — it simply evaporates.
 *
 *    The rule is symmetric and has no exemptions: an abandoned operation writes
 *    NOTHING back, and that includes clearing `busy`. Since `busy` also survives
 *    reconciliation, beginSession() is what clears it — for every kind, not just
 *    the one that happens to be commonest. Publish, unpublish and the cover
 *    upload all follow this; adding a fourth async action means capturing `gen`
 *    at the top and gating every write-back, its `finally` included.
 *
 * 4. NOTHING LEAVES WITHOUT BEING WRITTEN. Publish drains the in-flight save
 *    before it publishes (so it can never make an older version public) and
 *    refuses rather than publishing a stale one. Unmount flushes a pending
 *    debounce straight to the API instead of clearing the timer and losing the
 *    last ~1.5s of typing. A story whose id could not be resolved renders a
 *    recovery panel instead of a usable-but-unsaveable editor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, uploadImage } from '../api.js';
import { useAuth } from '../auth.jsx';
import RichEditor from '../editor/RichEditor.jsx';
import { EMPTY_DOC } from '../editor/extensions.js';

const AUTOSAVE_MS = 1500;
const MAX_TAGS = 10;

function isEmptyDoc(doc) {
  if (!doc || !Array.isArray(doc.content)) return true;
  return doc.content.every(
    (node) => node.type === 'paragraph' && !(node.content && node.content.length),
  );
}

function timeOfDay(date) {
  try {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

/** Resolve /write/:id to the full article, without a by-id API route. */
async function fetchArticleById(id, username) {
  const wanted = Number(id);
  if (!Number.isFinite(wanted)) throw new Error('That story id is not valid.');

  let match = null;
  try {
    const { articles = [] } = (await api.get('/api/articles/me/drafts')) || {};
    match = articles.find((a) => Number(a.id) === wanted) || null;
  } catch {
    /* fall through to the published list */
  }

  if (!match && username) {
    const { articles = [] } =
      (await api.get(`/api/articles?author=${encodeURIComponent(username)}&limit=100`)) || {};
    match = articles.find((a) => Number(a.id) === wanted) || null;
  }

  if (!match) throw new Error('That story could not be found, or it is not yours to edit.');
  return api.get(`/api/articles/${encodeURIComponent(match.slug)}`);
}

export default function EditorPage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [doc, setDoc] = useState(EMPTY_DOC);
  const [html, setHtml] = useState('');

  const [articleId, setArticleId] = useState(null);
  const [slug, setSlug] = useState('');
  const [status, setStatus] = useState('draft');

  const [saveState, setSaveState] = useState('idle'); // idle | dirty | saving | saved | error
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(''); // 'loading' | 'publishing' | 'cover' | ''
  const [loadFailed, setLoadFailed] = useState(false);
  const [drafts, setDrafts] = useState(null);
  const [draftsOpen, setDraftsOpen] = useState(false);

  const hydratedRef = useRef(false); // the form holds a real document
  const baselineRef = useRef(''); // signature of what the server already has
  const sessionRef = useRef(null); // which document the form holds: 'new' | '<id>'
  /**
   * The server-side identity of this document, updated SYNCHRONOUSLY the moment
   * a response lands. `articleId` state is for rendering; React has not
   * necessarily re-rendered yet when the next save or a publish reads it, and
   * an id that is still null one microtask after the POST returned would make
   * the next write POST a SECOND copy of the same story.
   */
  const identityRef = useRef({ id: null, slug: '', status: 'draft' });
  const genRef = useRef(0); // bumped by beginSession(); stamps every save
  const activeSaveRef = useRef(null); // the in-flight saveNow() promise, or null
  const rerunRef = useRef(false);
  const timerRef = useRef(null);
  const coverInputRef = useRef(null);
  const titleRef = useRef(null);
  const stateRef = useRef({});

  stateRef.current = { title, subtitle, coverUrl, tags, doc, html, articleId, status, slug };

  /** What the autosave compares against — content only, never save metadata. */
  const signatureOf = (snap) =>
    JSON.stringify({
      title: snap.title,
      subtitle: snap.subtitle,
      coverUrl: snap.coverUrl,
      tags: snap.tags,
      doc: snap.doc,
    });

  const payloadOf = (snap) => ({
    title: snap.title.trim() || 'Untitled',
    subtitle: snap.subtitle.trim() || null,
    contentJson: snap.doc,
    contentHtml: snap.html,
    coverUrl: snap.coverUrl || null,
    tags: snap.tags,
  });

  const isUntouched = (snap) =>
    !snap.title.trim() && !snap.subtitle.trim() && isEmptyDoc(snap.doc) && !snap.coverUrl;

  /** What is on screen right now, with the identity the SERVER has agreed to. */
  const snapshot = () => ({
    ...stateRef.current,
    articleId: identityRef.current.id,
    slug: identityRef.current.slug,
    status: identityRef.current.status,
  });

  /**
   * Start a new editing session: the form is about to hold a DIFFERENT document.
   *
   * Bumping the generation is what makes every in-flight request harmless — its
   * post-await write-backs all check `gen === genRef.current` and bail. Timers
   * (including the rerun timer armed from saveNow's finally block, which lives
   * outside React's effect lifecycle) are dropped here, and the save mutex is
   * released so the new session can save immediately without waiting on a
   * request that no longer has anywhere to land.
   *
   * THIS IS ALSO THE ONLY PLACE A SESSION'S `busy` IS CLEARED ON ABANDONMENT,
   * and it clears it whatever it holds. That is the other half of the
   * generation gate, not a nicety: because the gate makes an abandoned
   * operation's `finally` decline to clear `busy` (it must not clear the NEW
   * session's), the reset is the only thing left that can. A reset that cleared
   * only some kinds would wedge the rest — press Publish, then "New story"
   * while the request is in flight, and the brand-new draft would render its
   * Publish button disabled and reading "Publishing…" for the rest of the
   * session, with no request left alive to ever release it.
   */
  const beginSession = useCallback((key) => {
    genRef.current += 1;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    rerunRef.current = false;
    activeSaveRef.current = null;
    sessionRef.current = key;
    setBusy('');
    return genRef.current;
  }, []);

  /* ------------------------------------------------------------- load --- */

  const adopt = useCallback((article) => {
    const nextTitle = article.title === 'Untitled' ? '' : article.title || '';
    const nextTags = Array.isArray(article.tags) ? article.tags : [];
    const nextDoc = article.contentJson || EMPTY_DOC;
    baselineRef.current = JSON.stringify({
      title: nextTitle,
      subtitle: article.subtitle || '',
      coverUrl: article.coverUrl || '',
      tags: nextTags,
      doc: nextDoc,
    });
    identityRef.current = {
      id: article.id,
      slug: article.slug || '',
      status: article.status || 'draft',
    };
    setArticleId(article.id);
    setSlug(article.slug || '');
    setStatus(article.status || 'draft');
    setTitle(article.title === 'Untitled' ? '' : article.title || '');
    setSubtitle(article.subtitle || '');
    setCoverUrl(article.coverUrl || '');
    setTags(Array.isArray(article.tags) ? article.tags : []);
    setDoc(article.contentJson || EMPTY_DOC);
    setHtml(article.contentHtml || '');
    setSavedAt(null);
    setSaveState('idle');
  }, []);

  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (authLoading || !user) return undefined;

    // Which document does the URL ask for? saveNow() moves sessionRef itself
    // when a POST assigns an id, so the replace-navigate to /write/<newId> that
    // follows is recognised as the SAME session and never reloads.
    const wanted = routeId ? String(routeId) : 'new';
    // Already holding it. hydratedRef is deliberately NOT set here — only a
    // branch that actually put a document in the form may set it, so a failed
    // load can never be re-enabled for saving by an unrelated re-render.
    if (sessionRef.current === wanted) return undefined;

    /* ------------------------------------------------ new, empty story --- */
    if (!routeId) {
      beginSession('new');
      baselineRef.current = JSON.stringify({
        title: '',
        subtitle: '',
        coverUrl: '',
        tags: [],
        doc: EMPTY_DOC,
      });
      identityRef.current = { id: null, slug: '', status: 'draft' };
      setArticleId(null);
      setSlug('');
      setStatus('draft');
      setTitle('');
      setSubtitle('');
      setCoverUrl('');
      setTags([]);
      setDoc(EMPTY_DOC);
      setHtml('');
      setSaveState('idle');
      setSavedAt(null);
      setError('');
      setLoadFailed(false);
      // `busy` is already clear: beginSession() above drops it, whatever the
      // abandoned operation was — a load, a publish or a cover upload.
      hydratedRef.current = true;
      return undefined;
    }

    /* -------------------------------------------- resume an existing one --- */
    const gen = beginSession(wanted);
    let cancelled = false;
    hydratedRef.current = false;
    setBusy('loading');
    setError('');
    setLoadFailed(false);
    (async () => {
      try {
        const article = await fetchArticleById(routeId, user.username);
        if (cancelled || gen !== genRef.current) return;
        adopt(article);
        hydratedRef.current = true;
        setBusy('');
      } catch (err) {
        if (cancelled || gen !== genRef.current) return;
        // The form stays unhydrated, so nothing can be saved — say so loudly
        // and render the recovery panel instead of an editor that swallows
        // everything typed into it.
        setError(err?.message || 'Could not open that story.');
        setLoadFailed(true);
        setBusy('');
      }
    })();
    return () => {
      cancelled = true;
      // Release the claim if we are leaving before the document actually
      // arrived, so the next run re-fetches instead of early-returning on a
      // session that holds nothing. StrictMode double-invokes this effect in
      // development, so without it /write/:id would never load at all there.
      if (!hydratedRef.current && sessionRef.current === wanted) sessionRef.current = null;
    };
  }, [routeId, authLoading, user, adopt, beginSession, reloadNonce]);

  /* ------------------------------------------------------------- save --- */

  /**
   * One save round-trip, stamped with the generation it was started in.
   *
   * EVERY write-back below the await is gated on that stamp. If the writer left
   * for another story while this request was in flight, the response is dropped
   * on the floor: the old article id is not restored, the new story's baseline
   * is not overwritten with the old story's content, and the mutex/timers left
   * behind by beginSession() are not disturbed.
   */
  const runSave = useCallback(
    async (gen, snap) => {
      setSaveState('saving');
      setError('');
      const payload = payloadOf(snap);

      try {
        const saved = snap.articleId
          ? await api.put(`/api/articles/${snap.articleId}`, payload)
          : await api.post('/api/articles', payload);

        if (gen !== genRef.current) return null; // stale session — discard

        // Baseline is the snapshot that was SENT — anything typed while the
        // request was in flight still counts as unsaved and reschedules itself.
        baselineRef.current = signatureOf(snap);
        identityRef.current = {
          id: saved.id,
          slug: saved.slug || '',
          status: saved.status || 'draft',
        };
        setArticleId(saved.id);
        setSlug(saved.slug || '');
        setStatus(saved.status || 'draft');
        setSavedAt(new Date());
        setSaveState('saved');

        if (!snap.articleId) {
          // The POST just gave this session an identity. Claim it BEFORE the
          // navigate so the load effect recognises /write/<id> as the session
          // it is already holding and does not re-fetch it.
          sessionRef.current = String(saved.id);
          navigate(`/write/${saved.id}`, { replace: true });
        }
        return saved;
      } catch (err) {
        if (gen !== genRef.current) return null;
        setSaveState('error');
        setError(err?.message || 'Could not save that. Your text is still here — try again.');
        return null;
      } finally {
        if (gen === genRef.current && rerunRef.current) {
          // Something changed while the request was in flight. Re-arm — but the
          // timer fires outside React's effect lifecycle, so it re-checks the
          // generation itself rather than trusting that it still exists.
          rerunRef.current = false;
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            if (gen === genRef.current) saveNowRef.current?.();
          }, AUTOSAVE_MS);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate],
  );

  /** The save mutex. A second caller marks a rerun and awaits the first. */
  const saveNow = useCallback(() => {
    const snap = snapshot();
    if (!user || !hydratedRef.current) return Promise.resolve(null);
    if (!snap.articleId && isUntouched(snap)) return Promise.resolve(null);

    if (activeSaveRef.current) {
      rerunRef.current = true;
      return activeSaveRef.current;
    }

    const gen = genRef.current;
    const promise = runSave(gen, snap).finally(() => {
      if (activeSaveRef.current === promise) activeSaveRef.current = null;
    });
    activeSaveRef.current = promise;
    return promise;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSave, user]);

  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  /**
   * Persist everything on screen and only then hand back the identity.
   *
   * Publishing used to call saveNow() and, if a save was already in flight, get
   * null back from the mutex and quietly publish the OLDER version. This drains
   * the in-flight request first, then saves whatever is left dirty, so the
   * caller either gets an id whose server state matches the screen or nothing.
   */
  const flushSave = useCallback(async () => {
    const gen = genRef.current;
    clearTimeout(timerRef.current);
    timerRef.current = null;

    for (let pass = 0; pass < 5; pass += 1) {
      if (gen !== genRef.current) return null;

      if (activeSaveRef.current) {
        rerunRef.current = false; // this flush supersedes the scheduled rerun
        await activeSaveRef.current;
        clearTimeout(timerRef.current);
        timerRef.current = null;
        rerunRef.current = false;
        continue;
      }

      const snap = snapshot();
      if (signatureOf(snap) === baselineRef.current) {
        return snap.articleId
          ? { id: snap.articleId, slug: snap.slug, status: snap.status }
          : null;
      }

      const saved = await saveNow();
      if (gen !== genRef.current) return null;
      if (!saved) return null; // the save failed — the caller must not proceed
    }
    return null;
  }, [saveNow]);

  /* Debounced autosave on any change to the story. */
  useEffect(() => {
    if (authLoading || !user || !hydratedRef.current || busy === 'loading') return undefined;
    // Nothing has actually changed since the last save (or since load) — do not
    // burn a PUT just because the component re-rendered.
    if (signatureOf({ title, subtitle, coverUrl, tags, doc }) === baselineRef.current) {
      return undefined;
    }
    setSaveState((prev) => (prev === 'saving' ? prev : 'dirty'));
    clearTimeout(timerRef.current);
    const gen = genRef.current;
    timerRef.current = setTimeout(() => {
      if (gen === genRef.current) saveNow();
    }, AUTOSAVE_MS);
    return () => clearTimeout(timerRef.current);
  }, [title, subtitle, coverUrl, tags, doc, html, authLoading, user, busy, saveNow]);

  /**
   * Unmount: FLUSH, don't just cancel.
   *
   * Clearing the debounce on the way out threw away everything typed in the
   * last ~1.5s — including, after a publish, the edits made while the publish
   * request was in flight. There is no component left to update, so this writes
   * straight to the API and reports nothing.
   */
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const snap = snapshot();
      if (!hydratedRef.current) return;
      // A request already on the wire carries this content; firing a second one
      // would race it and could duplicate a brand-new story.
      if (activeSaveRef.current) return;
      if (signatureOf(snap) === baselineRef.current) return;
      if (!snap.articleId && isUntouched(snap)) return;
      const payload = payloadOf(snap);
      const write = snap.articleId
        ? api.put(`/api/articles/${snap.articleId}`, payload)
        : api.post('/api/articles', payload);
      write.catch(() => {});
    },
    [],
  );

  const onEditorChange = useCallback(({ json, html: nextHtml }) => {
    setDoc(json);
    setHtml(nextHtml);
  }, []);

  /* ---------------------------------------------------------- actions --- */

  const publish = async () => {
    const gen = genRef.current;
    setBusy('publishing');
    setError('');
    try {
      // Everything on screen must be on the server BEFORE we make it public —
      // no falling back to a half-saved id and publishing an older version.
      const saved = await flushSave();
      if (gen !== genRef.current) return;

      if (!saved?.id) {
        if (isUntouched(stateRef.current) && !identityRef.current.id) {
          throw new Error('Write something first — there is nothing to publish yet.');
        }
        throw new Error(
          'Your latest edits have not saved yet, so publishing would put an older version live. Nothing was published — try again in a moment.',
        );
      }
      // Belt and braces: if anything changed between the flush and here, do not
      // publish a version the writer can no longer see on screen.
      if (signatureOf(stateRef.current) !== baselineRef.current) {
        throw new Error(
          'You kept typing while that was saving. Nothing was published — give it a second and press Publish again.',
        );
      }

      const published = await api.post(`/api/articles/${saved.id}/publish`);
      if (gen !== genRef.current) return;
      identityRef.current = {
        ...identityRef.current,
        slug: published.slug,
        status: published.status,
      };
      setStatus(published.status);
      setSlug(published.slug);
      navigate(`/article/${published.slug}`);
    } catch (err) {
      if (gen === genRef.current) setError(err?.message || 'Publishing failed.');
    } finally {
      if (gen === genRef.current) setBusy('');
    }
  };

  /** Re-attempt a load that failed — the session is released so it re-runs. */
  const retryLoad = () => {
    sessionRef.current = null;
    setLoadFailed(false);
    setError('');
    setReloadNonce((n) => n + 1);
  };

  /**
   * Same generation contract as publish(). Without it an unpublish that the
   * writer walked out on lands on whatever the form holds NOW: it would stamp
   * the old story's status onto the new session's identityRef and flip a
   * brand-new draft's badge, because identityRef is what the next save and
   * publish both read.
   */
  const unpublish = async () => {
    const target = identityRef.current.id;
    if (!target) return;
    const gen = genRef.current;
    setBusy('publishing');
    setError('');
    try {
      const updated = await api.post(`/api/articles/${target}/unpublish`);
      if (gen !== genRef.current) return;
      identityRef.current = { ...identityRef.current, status: updated.status };
      setStatus(updated.status);
    } catch (err) {
      if (gen === genRef.current) setError(err?.message || 'Could not unpublish that story.');
    } finally {
      // Only this session's own busy — an abandoned one was already cleared by
      // beginSession, and clearing here would stomp the NEW session's state.
      if (gen === genRef.current) setBusy('');
    }
  };

  /**
   * Ditto: an upload the writer walked out on must not drop the old story's
   * cover image into the new one, where autosave would then persist it.
   */
  const pickCover = async (file) => {
    if (!file) return;
    const gen = genRef.current;
    setBusy('cover');
    setError('');
    try {
      const url = await uploadImage(file);
      if (gen !== genRef.current) return;
      setCoverUrl(url);
    } catch (err) {
      if (gen === genRef.current) setError(err?.message || 'That cover image would not upload.');
    } finally {
      if (gen === genRef.current) setBusy('');
    }
  };

  const openDrafts = async () => {
    setDraftsOpen((open) => !open);
    if (drafts) return;
    try {
      const { articles = [] } = (await api.get('/api/articles/me/drafts')) || {};
      setDrafts(articles);
    } catch {
      setDrafts([]);
    }
  };

  const commitTag = () => {
    const next = tagDraft.trim().toLowerCase().replace(/^#/, '');
    setTagDraft('');
    if (!next || tags.includes(next) || tags.length >= MAX_TAGS) return;
    setTags([...tags, next]);
  };

  /* Title grows with its content instead of scrolling. */
  useEffect(() => {
    const node = titleRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [title]);

  /* ----------------------------------------------------------- render --- */

  const saveLabel = useMemo(() => {
    if (busy === 'loading') return 'Opening…';
    if (saveState === 'saving') return 'Saving…';
    if (saveState === 'error') return 'Not saved';
    if (saveState === 'saved' && savedAt) return `Saved at ${timeOfDay(savedAt)}`;
    if (saveState === 'dirty') return 'Unsaved changes';
    return articleId ? 'All changes saved' : 'Draft';
  }, [busy, saveState, savedAt, articleId]);

  if (authLoading) {
    return (
      <div className="container section text-center muted" role="status">
        <span className="spinner" aria-hidden="true" style={{ margin: '0 auto' }} />
        <span className="sr-only">Loading your session</span>
      </div>
    );
  }

  /**
   * The story behind /write/:id could not be opened, so the form was never
   * hydrated and NOTHING typed here could ever be saved. Showing a working
   * editor would be a trap — the status would read "Draft" while every
   * keystroke went nowhere. Offer the two ways out instead.
   */
  if (loadFailed) {
    return (
      <div className="container section mi-write-recover" data-page="editor">
        <p className="eyebrow">Story unavailable</p>
        <h1 className="h2">That story could not be opened</h1>
        <p className="muted" role="alert">
          {error || 'It may have been deleted, or it belongs to another writer.'}{' '}
          Nothing you type here would be saved, so the editor is closed.
        </p>
        <div className="cluster" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <button type="button" className="btn btn-primary" onClick={retryLoad}>
            Try again
          </button>
          <Link className="btn btn-ghost" to="/write">
            Start a new story
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mi-write" data-page="editor">
      <header className="mi-write-bar">
        <div className="mi-write-bar-inner">
          <div className="cluster" style={{ gap: 'var(--space-3)' }}>
            <span className={`badge ${status === 'draft' ? 'badge-draft' : ''}`}>
              {status === 'published' ? 'Published' : 'Draft'}
            </span>
            <span className={`mi-save-state is-${saveState}`} role="status" aria-live="polite">
              {saveLabel}
            </span>
          </div>

          <div className="cluster" style={{ gap: 'var(--space-2)' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={openDrafts}>
              Drafts
            </button>
            <Link className="btn btn-ghost btn-sm" to="/write" onClick={() => setDraftsOpen(false)}>
              New story
            </Link>
            {slug && status === 'published' ? (
              <Link className="btn btn-ghost btn-sm" to={`/article/${slug}`}>
                View
              </Link>
            ) : null}
            {status === 'published' ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={unpublish}
                disabled={busy === 'publishing'}
              >
                Unpublish
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={publish}
                disabled={busy === 'publishing' || busy === 'loading'}
              >
                {busy === 'publishing' ? 'Publishing…' : 'Publish'}
              </button>
            )}
          </div>
        </div>

        {draftsOpen ? (
          <div className="mi-drafts">
            <p className="eyebrow">Your drafts</p>
            {drafts === null ? <p className="muted">Loading…</p> : null}
            {drafts && drafts.length === 0 ? (
              <p className="muted">No drafts yet — this one will appear here as soon as it saves.</p>
            ) : null}
            <ul className="mi-drafts-list">
              {(drafts || []).map((draft) => (
                <li key={draft.id}>
                  <Link
                    to={`/write/${draft.id}`}
                    className="mi-draft-row"
                    onClick={() => setDraftsOpen(false)}
                  >
                    <span className="mi-draft-title">{draft.title || 'Untitled'}</span>
                    <span className="meta">
                      {draft.readingTime} min read
                      {draft.excerpt ? ` · ${draft.excerpt.slice(0, 70)}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>

      {/* Inert while a story is still being fetched: the form is not hydrated
          yet, so anything typed now would be discarded by adopt(). */}
      <main
        className={`mi-write-canvas${busy === 'loading' ? ' is-loading' : ''}`}
        aria-busy={busy === 'loading'}
      >
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="mi-cover">
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              pickCover(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {coverUrl ? (
            <div className="mi-cover-shell">
              <img src={coverUrl} alt="" className="mi-cover-img" />
              <div className="mi-cover-actions">
                <button
                  type="button"
                  className="mi-node-btn"
                  onClick={() => coverInputRef.current?.click()}
                >
                  Replace cover
                </button>
                <button
                  type="button"
                  className="mi-node-btn is-danger"
                  onClick={() => setCoverUrl('')}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="mi-cover-add"
              onClick={() => coverInputRef.current?.click()}
              disabled={busy === 'cover'}
            >
              {busy === 'cover' ? 'Uploading cover…' : '＋ Add a cover image'}
            </button>
          )}
        </div>

        <textarea
          ref={titleRef}
          className="mi-title-input"
          rows={1}
          value={title}
          placeholder="Title"
          aria-label="Title"
          onChange={(event) => setTitle(event.target.value.replace(/\n/g, ''))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
        />

        <input
          className="mi-subtitle-input"
          value={subtitle}
          placeholder="A subtitle that says why this matters…"
          aria-label="Subtitle"
          onChange={(event) => setSubtitle(event.target.value)}
        />

        <div className="mi-tags">
          {tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
              <button
                type="button"
                className="mi-tag-x"
                aria-label={`Remove ${tag}`}
                onClick={() => setTags(tags.filter((t) => t !== tag))}
              >
                ×
              </button>
            </span>
          ))}
          {tags.length < MAX_TAGS ? (
            <input
              className="mi-tag-input"
              value={tagDraft}
              placeholder={tags.length ? 'Add another tag…' : 'Add up to 10 tags…'}
              aria-label="Add a tag"
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={commitTag}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  commitTag();
                } else if (event.key === 'Backspace' && !tagDraft && tags.length) {
                  setTags(tags.slice(0, -1));
                }
              }}
            />
          ) : null}
        </div>

        <RichEditor value={doc} onChange={onEditorChange} />
      </main>
    </div>
  );
}
