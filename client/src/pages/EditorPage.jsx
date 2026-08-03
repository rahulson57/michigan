/**
 * EditorPage — /write (new story) and /write/:id (resume one).
 *
 * Composition surface: cover image, title, subtitle, tags, then the RichEditor.
 * The draft autosaves ~1.5s after you stop typing (POST /api/articles the first
 * time, PUT /api/articles/:id after that) and publishing hands off to
 * /article/:slug.
 *
 * Two notes worth keeping in mind if you touch this file:
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
  const [drafts, setDrafts] = useState(null);
  const [draftsOpen, setDraftsOpen] = useState(false);

  const hydratedRef = useRef(false); // the form holds a real document
  const baselineRef = useRef(''); // signature of what the server already has
  const savingRef = useRef(false);
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

  useEffect(() => {
    if (authLoading || !user) return undefined;

    // New story — reset only when arriving from an existing one.
    if (!routeId) {
      if (articleId !== null) {
        baselineRef.current = JSON.stringify({
          title: '',
          subtitle: '',
          coverUrl: '',
          tags: [],
          doc: EMPTY_DOC,
        });
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
      }
      hydratedRef.current = true;
      return undefined;
    }

    if (articleId !== null && String(articleId) === String(routeId)) {
      hydratedRef.current = true;
      return undefined;
    }

    let cancelled = false;
    hydratedRef.current = false;
    setBusy('loading');
    setError('');
    (async () => {
      try {
        const article = await fetchArticleById(routeId, user.username);
        if (cancelled) return;
        adopt(article);
        hydratedRef.current = true;
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not open that story.');
      } finally {
        if (!cancelled) setBusy('');
      }
    })();
    return () => {
      cancelled = true;
    };
    // articleId is intentionally read, not tracked — a save that assigns the id
    // must not re-trigger a load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, authLoading, user, adopt]);

  /* ------------------------------------------------------------- save --- */

  const saveNow = useCallback(async () => {
    const snap = stateRef.current;
    if (!user || !hydratedRef.current) return null;

    const untouched = !snap.title.trim() && !snap.subtitle.trim() && isEmptyDoc(snap.doc) && !snap.coverUrl;
    if (!snap.articleId && untouched) return null;

    if (savingRef.current) {
      rerunRef.current = true;
      return null;
    }

    savingRef.current = true;
    setSaveState('saving');
    setError('');

    const payload = {
      title: snap.title.trim() || 'Untitled',
      subtitle: snap.subtitle.trim() || null,
      contentJson: snap.doc,
      contentHtml: snap.html,
      coverUrl: snap.coverUrl || null,
      tags: snap.tags,
    };

    try {
      const saved = snap.articleId
        ? await api.put(`/api/articles/${snap.articleId}`, payload)
        : await api.post('/api/articles', payload);

      // Baseline is the snapshot that was SENT — anything typed while the
      // request was in flight still counts as unsaved and reschedules itself.
      baselineRef.current = signatureOf(snap);
      setArticleId(saved.id);
      setSlug(saved.slug || '');
      setStatus(saved.status || 'draft');
      setSavedAt(new Date());
      setSaveState('saved');

      if (!snap.articleId) navigate(`/write/${saved.id}`, { replace: true });
      return saved;
    } catch (err) {
      setSaveState('error');
      setError(err?.message || 'Could not save that. Your text is still here — try again.');
      return null;
    } finally {
      savingRef.current = false;
      if (rerunRef.current) {
        rerunRef.current = false;
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => saveNow(), AUTOSAVE_MS);
      }
    }
  }, [navigate, user]);

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
    timerRef.current = setTimeout(() => saveNow(), AUTOSAVE_MS);
    return () => clearTimeout(timerRef.current);
  }, [title, subtitle, coverUrl, tags, doc, html, authLoading, user, busy, saveNow]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const onEditorChange = useCallback(({ json, html: nextHtml }) => {
    setDoc(json);
    setHtml(nextHtml);
  }, []);

  /* ---------------------------------------------------------- actions --- */

  const publish = async () => {
    setBusy('publishing');
    setError('');
    try {
      clearTimeout(timerRef.current);
      const saved = (await saveNow()) || { id: articleId, slug };
      const targetId = saved?.id || articleId;
      if (!targetId) throw new Error('Write something first — there is nothing to publish yet.');
      const published = await api.post(`/api/articles/${targetId}/publish`);
      setStatus(published.status);
      setSlug(published.slug);
      navigate(`/article/${published.slug}`);
    } catch (err) {
      setError(err?.message || 'Publishing failed.');
    } finally {
      setBusy('');
    }
  };

  const unpublish = async () => {
    setBusy('publishing');
    setError('');
    try {
      const updated = await api.post(`/api/articles/${articleId}/unpublish`);
      setStatus(updated.status);
    } catch (err) {
      setError(err?.message || 'Could not unpublish that story.');
    } finally {
      setBusy('');
    }
  };

  const pickCover = async (file) => {
    if (!file) return;
    setBusy('cover');
    setError('');
    try {
      setCoverUrl(await uploadImage(file));
    } catch (err) {
      setError(err?.message || 'That cover image would not upload.');
    } finally {
      setBusy('');
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

      <main className="mi-write-canvas">
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
