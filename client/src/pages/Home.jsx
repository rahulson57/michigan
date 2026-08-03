/**
 * Home — the michigan feed.
 *
 * Route: `/` (see client/src/App.jsx)
 *
 * Two rankings ("For you" = `sort=recent`, "Top" = `sort=top`), an optional tag
 * filter, and paging by `offset`. The right-hand rail (<Sidebar/>) shows what is
 * trending and a topic cloud; feed.css hides it below 900px.
 *
 * Data: `GET /api/articles?sort=recent|top&tag=<name>&limit=20&offset=<n>`
 *       → `{articles: ArticleSummary[], total: number}`
 *
 * Paging appends. Changing the tab or the tag starts a new query from offset 0;
 * "Load more" only ever requests offset = items.length, so page 1 is never
 * refetched. Every first-page request carries a sequence number and stale replies
 * are dropped, so quickly toggling tabs cannot interleave two rankings.
 *
 * The tag filter is mirrored into the URL as `/?tag=<name>` so a filtered feed is
 * linkable and the tag chips on <ArticleCard/> can be plain links.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import ArticleCard from '../components/ArticleCard.jsx';
import Sidebar from '../components/Sidebar.jsx';
import '../styles/feed.css';

const PAGE_SIZE = 20;

const TABS = [
  { key: 'recent', label: 'For you' },
  { key: 'top', label: 'Top' },
];

function buildQuery({ sort, tag, offset, limit = PAGE_SIZE }) {
  const params = new URLSearchParams({
    sort,
    limit: String(limit),
    offset: String(offset),
  });
  if (tag) params.set('tag', tag);
  return `/api/articles?${params.toString()}`;
}

/** Skeleton feed row — the loading state is the shape of the content, not a spinner. */
function SkeletonCard() {
  return (
    <div className="acard acard-feed acard-skeleton" aria-hidden="true">
      <div className="acard-body">
        <span className="row">
          <span className="skeleton avatar" />
          <span className="stack" style={{ '--gap': 'var(--space-2)' }}>
            <span className="skeleton sk-line" style={{ width: 120 }} />
            <span className="skeleton sk-line sk-line-sm" style={{ width: 90 }} />
          </span>
        </span>
        <span className="skeleton sk-line sk-line-title" style={{ width: '85%' }} />
        <span className="skeleton sk-line" style={{ width: '100%' }} />
        <span className="skeleton sk-line" style={{ width: '62%' }} />
        <span className="skeleton sk-chip" style={{ width: 160 }} />
      </div>
      <div className="acard-cover">
        <span className="skeleton sk-fill" />
      </div>
    </div>
  );
}

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tag = searchParams.get('tag') || null;

  const [sort, setSort] = useState('recent');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  // Bumped by "Try again" so a failed load can be retried without a page reload.
  const [reloadToken, setReloadToken] = useState(0);

  // Guards against out-of-order replies when the tab or tag changes mid-flight.
  const requestSeq = useRef(0);

  // First page — reruns whenever the ranking or the tag filter changes.
  useEffect(() => {
    const seq = (requestSeq.current += 1);
    setLoading(true);
    setError(null);

    api
      .get(buildQuery({ sort, tag, offset: 0 }))
      .then((data) => {
        if (seq !== requestSeq.current) return; // a newer query has taken over
        setItems(data?.articles || []);
        setTotal(Number(data?.total || 0));
        setLoading(false);
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setError(err?.message || 'Could not load the feed.');
        setItems([]);
        setTotal(0);
        setLoading(false);
      });
  }, [sort, tag, reloadToken]);

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);

  const loadMore = useCallback(() => {
    if (loadingMore || loading) return;
    const seq = requestSeq.current; // deliberately not bumped — this extends the current query
    const offset = items.length; // never refetches page 1
    setLoadingMore(true);

    api
      .get(buildQuery({ sort, tag, offset }))
      .then((data) => {
        if (seq !== requestSeq.current) return;
        const next = data?.articles || [];
        setItems((prev) => {
          const seen = new Set(prev.map((a) => a.id));
          return [...prev, ...next.filter((a) => !seen.has(a.id))];
        });
        setTotal(Number(data?.total || 0));
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setError(err?.message || 'Could not load more stories.');
      })
      .finally(() => {
        // Deliberately NOT gated on `seq`. Releasing the button is bookkeeping for
        // *this* request, not for the reply's contents: if a stale page-2 reply
        // returned before clearing the flag, `loadingMore` would stay true forever
        // (switch tab or tag while "Load more" is in flight) and both the button and
        // the guard above would block every further page until Home remounts.
        setLoadingMore(false);
      });
  }, [items.length, loading, loadingMore, sort, tag]);

  const selectTag = useCallback(
    (next) => {
      const params = new URLSearchParams(searchParams);
      if (next) params.set('tag', next);
      else params.delete('tag');
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const hasMore = items.length < total;

  return (
    <div className="container feed-layout">
      <div className="feed-main stack">
        <header className="stack stack-sm feed-head">
          <hr className="rule-accent" />
          <h1 className="page-title">Things worth the time.</h1>
          <p className="lede">
            Essays on systems, design, research and craft — written by people who had to
            learn it the slow way.
          </p>
        </header>

        <div className="feed-controls">
          <div className="feed-tabs" role="tablist" aria-label="Feed ranking">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={sort === t.key}
                className={`feed-tab${sort === t.key ? ' is-active' : ''}`}
                onClick={() => setSort(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tag && (
            <div className="cluster feed-filter" style={{ '--gap': 'var(--space-2)' }}>
              <span className="meta">Filtered by</span>
              <button
                type="button"
                className="tag tag-button is-active"
                onClick={() => selectTag(null)}
                title={`Clear the “${tag}” filter`}
              >
                {tag} <span aria-hidden="true">×</span>
                <span className="sr-only">— clear this filter</span>
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="alert alert-error feed-alert" role="alert">
            <span>{error}</span>{' '}
            <button type="button" className="btn btn-sm" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {loading ? (
          <div className="feed-list" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonCard key={i} />
            ))}
            <span className="sr-only" role="status">
              Loading stories
            </span>
          </div>
        ) : items.length === 0 && error ? (
          /*
            A FAILED load is not an empty feed. `items` is cleared on error so the
            previous ranking cannot linger, which would otherwise fall through to the
            "quiet right now" copy and tell the reader the site has no stories when in
            fact the request never landed. The banner above already says what went
            wrong and offers a retry, so this branch stays deliberately silent.
          */
          null
        ) : items.length === 0 ? (
          <div className="empty">
            <p className="card-title">
              {tag ? `Nothing tagged “${tag}” yet.` : 'The feed is quiet right now.'}
            </p>
            <p className="muted">
              {tag
                ? 'Try another topic — or clear the filter and see everything.'
                : 'As soon as someone publishes a story, it will show up here.'}
            </p>
            {tag && (
              <button type="button" className="btn" onClick={() => selectTag(null)}>
                Clear the filter
              </button>
            )}
          </div>
        ) : (
          <>
            {/*
              DEC-147: the engagement bar is NOT wired here. ArticleCard exposes
              an `actions` slot and it is deliberately left unset — the
              integration task supplies it once the engagement task has merged.
              See the "actions slot" section of ArticleCard's docblock for the
              exact shape that component's onChange emits; it is keyed by
              `articleId`, not `id`, and a handler written here today against a
              component that does not exist yet would be guesswork.
            */}
            <div className="feed-list">
              {items.map((article) => (
                <ArticleCard key={article.id} article={article} variant="feed" />
              ))}
            </div>

            <div className="feed-more">
              {hasMore ? (
                <button
                  type="button"
                  className="btn btn-lg"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <>
                      <span className="spinner" aria-hidden="true" /> Loading…
                    </>
                  ) : (
                    `Load more stories (${total - items.length} left)`
                  )}
                </button>
              ) : (
                <p className="meta">
                  That&apos;s everything{tag ? ` tagged “${tag}”` : ''} — {items.length}{' '}
                  {items.length === 1 ? 'story' : 'stories'}.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <Sidebar activeTag={tag} onSelectTag={selectTag} />
    </div>
  );
}
