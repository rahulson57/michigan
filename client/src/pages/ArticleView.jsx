/**
 * ArticleView — the reading experience.
 *
 * Route: `/article/:slug` (see client/src/App.jsx)
 * Data:  `GET /api/articles/:slug` → ArticleFull
 *        `GET /api/articles?author=<username>` → "More from …"
 *
 * The body is rendered ONLY through <RichContent/>, and it is given BOTH the
 * HTML and the TipTap JSON. That is the contract with the editor task: the
 * interactive renderer (charts, timelines, embeds) reads `json` and falls back
 * to `html`. This page never touches article HTML itself.
 *
 * Drafts are returned by the API only to their author; when the viewer owns an
 * unpublished story the page shows a Draft badge and a link to the editor.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, profilePath } from '../api.js';
import { useAuth } from '../auth.jsx';
import RichContent from '../editor/RichContent.jsx';
import ArticleCard from '../components/ArticleCard.jsx';
import AuthorChip, { Avatar, formatDate } from '../components/AuthorChip.jsx';
import '../styles/feed.css';

/** Social handles, in the order they read best under a bio. */
const SOCIALS = [
  { key: 'twitter', label: 'Twitter', href: (v) => `https://twitter.com/${v.replace(/^@/, '')}` },
  { key: 'github', label: 'GitHub', href: (v) => `https://github.com/${v.replace(/^@/, '')}` },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    href: (v) => `https://www.linkedin.com/in/${v.replace(/^@/, '')}`,
  },
  { key: 'website', label: 'Website', href: (v) => (/^https?:\/\//.test(v) ? v : `https://${v}`) },
];

function ReaderSkeleton() {
  return (
    <div className="container reader" aria-busy="true">
      <div className="measure stack">
        <span className="skeleton sk-line sk-line-sm" style={{ width: 140 }} />
        <span className="skeleton sk-line sk-line-display" style={{ width: '92%' }} />
        <span className="skeleton sk-line sk-line-display" style={{ width: '58%' }} />
        <span className="skeleton sk-line" style={{ width: '70%' }} />
        <span className="row">
          <span className="skeleton avatar avatar-lg" />
          <span className="stack" style={{ '--gap': 'var(--space-2)' }}>
            <span className="skeleton sk-line" style={{ width: 160 }} />
            <span className="skeleton sk-line sk-line-sm" style={{ width: 120 }} />
          </span>
        </span>
      </div>
      <div className="reader-coverbox">
        <span className="skeleton sk-fill" />
      </div>
      <div className="measure stack">
        {['96%', '100%', '88%', '100%', '72%', '94%', '100%', '65%'].map((w, i) => (
          <span key={i} className="skeleton sk-line" style={{ width: w }} />
        ))}
      </div>
      <span className="sr-only" role="status">
        Loading the story
      </span>
    </div>
  );
}

function NotFoundState({ message }) {
  return (
    <div className="container-narrow section stack text-center">
      <p className="eyebrow">404</p>
      <h1 className="page-title">We couldn&apos;t find that story.</h1>
      <p className="muted">
        {message ||
          'The link may be broken, or the story may have been unpublished by its author.'}
      </p>
      <div className="cluster" style={{ justifyContent: 'center' }}>
        <Link className="btn btn-primary" to="/">
          Back to the home feed
        </Link>
      </div>
    </div>
  );
}

/** Full-bleed cover that removes itself if the image fails to load. */
function Cover({ url, alt }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <figure className="reader-coverbox">
      <img src={url} alt={alt} decoding="async" onError={() => setFailed(true)} />
    </figure>
  );
}

function AuthorCard({ author }) {
  if (!author) return null;
  const links = SOCIALS.filter((s) => author[s.key]);

  return (
    <section className="panel reader-authorcard stack">
      <div className="reader-authorcard-head">
        <Link to={profilePath(author.username)} aria-label={author.name || author.username}>
          <Avatar author={author} size="lg" />
        </Link>
        <div className="stack" style={{ '--gap': 'var(--space-1)' }}>
          <p className="eyebrow">Written by</p>
          <h2 className="card-title">
            <Link className="link-quiet" to={profilePath(author.username)}>
              {author.name || author.username}
            </Link>
          </h2>
          <p className="meta">@{author.username}</p>
        </div>
      </div>

      {author.bio && <p className="reader-bio">{author.bio}</p>}

      <div className="cluster" style={{ '--gap': 'var(--space-2)' }}>
        <Link className="btn btn-sm" to={profilePath(author.username)}>
          See all their stories
        </Link>
        {links.map((s) => (
          <a
            key={s.key}
            className="btn btn-sm btn-ghost"
            href={s.href(String(author[s.key]))}
            target="_blank"
            rel="noreferrer noopener"
          >
            {s.label}
          </a>
        ))}
      </div>
    </section>
  );
}

export default function ArticleView() {
  const { slug } = useParams();
  const { user } = useAuth();

  const [article, setArticle] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | missing | error
  const [error, setError] = useState(null);
  const [more, setMore] = useState([]);

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    setArticle(null);
    setMore([]);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'auto' });

    api
      .get(`/api/articles/${encodeURIComponent(slug)}`)
      .then((data) => {
        if (!alive) return;
        setArticle(data);
        setStatus('ready');
      })
      .catch((err) => {
        if (!alive) return;
        if (err?.status === 404) {
          setStatus('missing');
        } else {
          setError(err?.message || 'Could not load this story.');
          setStatus('error');
        }
      });

    return () => {
      alive = false;
    };
  }, [slug]);

  // "More from <author>" — fetched once the article (and so the author) is known.
  const authorUsername = article?.author?.username;
  useEffect(() => {
    if (!authorUsername) return undefined;
    let alive = true;

    api
      .get(`/api/articles?author=${encodeURIComponent(authorUsername)}&limit=4&offset=0`)
      .then((data) => {
        if (!alive) return;
        setMore((data?.articles || []).filter((a) => a.id !== article.id).slice(0, 3));
      })
      .catch(() => {
        if (alive) setMore([]); // a quiet section is better than an error here
      });

    return () => {
      alive = false;
    };
  }, [authorUsername, article?.id]);

  if (status === 'loading') return <ReaderSkeleton />;
  if (status === 'missing') return <NotFoundState />;
  if (status === 'error') return <NotFoundState message={error} />;
  if (!article) return <NotFoundState />;

  const isDraft = article.status !== 'published';
  const isOwner = Boolean(user && article.author && user.id === article.author.id);
  const dateLabel = formatDate(article.publishedAt);

  return (
    <article className="container reader">
      <header className="measure stack reader-head">
        <div className="cluster" style={{ '--gap': 'var(--space-3)' }}>
          <Link className="meta link-quiet reader-back" to="/">
            ← All stories
          </Link>
          {isDraft && <span className="badge badge-draft">Draft</span>}
          {isDraft && isOwner && (
            <Link className="link meta" to={`/write/${article.id}`}>
              Edit this draft
            </Link>
          )}
        </div>

        <h1 className="display reader-title">{article.title}</h1>

        {article.subtitle && <p className="lede reader-subtitle">{article.subtitle}</p>}

        <div className="reader-byline">
          <AuthorChip
            author={article.author}
            publishedAt={article.publishedAt}
            readingTime={article.readingTime}
            size="md"
          />
        </div>

        {Array.isArray(article.tags) && article.tags.length > 0 && (
          <div className="cluster" style={{ '--gap': 'var(--space-2)' }}>
            {article.tags.map((tag) => (
              <Link key={tag} className="tag" to={`/?tag=${encodeURIComponent(tag)}`}>
                {tag}
              </Link>
            ))}
          </div>
        )}

        <hr className="divider" />
      </header>

      <Cover url={article.coverUrl} alt={`Cover image for “${article.title}”`} />

      {/*
        The body. BOTH props are passed by contract — the editor task's renderer
        reads `json` for interactive nodes and uses `html` as the fallback.
      */}
      <div className="measure reader-body">
        <RichContent html={article.contentHtml} json={article.contentJson} />
      </div>

      {/*
        Floating action bar. Sticks to the bottom of the viewport while the story
        scrolls past.

        ▼▼ INTEGRATION SLOT — TASK-006 ▼▼
        The empty <div data-slot="article-actions"> below is where the engagement
        task's bar goes, once that component exists on main. Per DEC-147 this page
        must not import it, stub it, or reimplement reactions/save/reshare, so the
        slot ships empty and CSS (`[data-slot="article-actions"]:empty`) collapses
        it to nothing in the meantime.

        To wire it, add the import and render the bar inside the slot with
        `article={article} onChange={…}`. Its onChange emits an engagement DELTA
        keyed by `articleId` — the captured keys are exactly
        ['articleId','stats','viewer','saved','reshared','pending','error'] and
        there is NO bare `id` — so the handler here must be

          setArticle((prev) =>
            prev && prev.id === payload.articleId
              ? {...prev, stats: payload.stats, viewer: payload.viewer}
              : prev);

        (Shape captured from the real component on branch nexus/agent/TASK-005,
        commit 660aea7, by clicking it in this slot in a throwaway tree — not
        assumed. Merging on `payload.id` drops every update silently.)
        ▲▲ INTEGRATION SLOT — TASK-006 ▲▲
      */}
      <div className="reader-actionbar" role="toolbar" aria-label="Story actions">
        <div className="reader-actionbar-inner">
          <span className="meta truncate reader-actionbar-title">{article.title}</span>
          <div className="reader-actionbar-slot" data-slot="article-actions" />
          <button
            type="button"
            className="btn btn-sm btn-ghost reader-totop"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <span aria-hidden="true">↑</span> Top
          </button>
        </div>
      </div>

      <footer className="measure stack stack-lg reader-foot">
        <div className="stack stack-sm">
          <hr className="divider" />
          <p className="meta">
            {dateLabel && <span>Published {dateLabel}</span>}
            {dateLabel && article.readingTime ? (
              <span className="meta-dot">{article.readingTime} min read</span>
            ) : null}
          </p>
        </div>

        <AuthorCard author={article.author} />

        {more.length > 0 && (
          <section className="stack stack-sm reader-more">
            <hr className="rule-accent" />
            <h2 className="section-title">
              More from {article.author?.name || article.author?.username}
            </h2>
            <div className="stack stack-sm">
              {more.map((item) => (
                <ArticleCard key={item.id} article={item} variant="compact" />
              ))}
            </div>
          </section>
        )}
      </footer>
    </article>
  );
}
