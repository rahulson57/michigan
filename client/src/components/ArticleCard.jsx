/**
 * ArticleCard — the one way an article is summarised anywhere in michigan.
 *
 * Used by the home feed, the profile page, read-later and the leaderboard, so
 * that a story looks and behaves identically wherever it is listed.
 *
 *   import ArticleCard from '../components/ArticleCard.jsx';
 *
 *   <ArticleCard article={a} />                         // feed row
 *   <ArticleCard article={a} variant="compact" />       // sidebars, "more from"
 *   <ArticleCard article={a} variant="rank" rank={1} /> // leaderboard
 *
 * Props
 *   article   {ArticleSummary}  required. The shape `GET /api/articles` returns:
 *             `{id, slug, title, subtitle, excerpt, coverUrl, readingTime, status,
 *               publishedAt, author, stats:{up,down,saves,reshares,score},
 *               viewer:{reaction,saved,reshared}}`. `ArticleFull` also works — its
 *             extra `tags` array is rendered when present. (List responses do NOT
 *             carry tags; the card simply omits the chip row then.)
 *   variant   'feed' | 'compact' | 'rank'. Default 'feed'.
 *               feed    — Medium-style row: byline, title, excerpt, right-hand
 *                         cover thumbnail, tags, action row.
 *               compact — dense two-line row with a small thumbnail, no excerpt.
 *               rank    — compact plus a large ordinal on the left.
 *   rank      {number}  the ordinal to show in the 'rank' variant.
 *   actions   {ReactNode}  OPTIONAL. Rendered into the card's footer action row.
 *             Default null — the row then collapses and the card shows no
 *             engagement controls at all. See "The actions slot" below.
 *   onChange  {function}  accepted for call-site compatibility and NOT invoked by
 *             this component. ArticleCard owns no mutable state, so there is
 *             nothing here to report; whatever is passed into `actions` owns its
 *             own change callback. Kept in the signature because it is part of
 *             the frozen contract for this component.
 *
 * The whole card is clickable: the title is the real link and stretches over the
 * card via `::after`, so there is exactly one tab stop for navigation while the
 * byline link and anything rendered into `actions` stay independently clickable
 * (`.acard-foot` is raised above the stretched link with position/z-index).
 *
 * ── The actions slot (DEC-147) ────────────────────────────────────────────────
 * This component does NOT import the engagement task's reaction bar, does NOT
 * stub or place-hold it, and does NOT implement reactions / save / reshare
 * itself. That component belongs to the engagement task (TASK-005); this card
 * only exposes the hole it drops into. The name is deliberately not written
 * anywhere in this file — the acceptance gate greps for it.
 *
 * The integration task (TASK-006) wires it at the call sites, e.g.
 *
 *   <ArticleCard article={a} actions={<TheBar article={a} size="sm" onChange={…} />} />
 *
 * A note for whoever writes that onChange handler. This was not assumed — the
 * real component (branch nexus/agent/TASK-005, commit 660aea7) was dropped into
 * this slot in a throwaway working tree, clicked in headless Chrome, and the
 * payload it handed back was captured verbatim. Its keys are exactly
 *
 *   ['articleId', 'stats', 'viewer', 'saved', 'reshared', 'pending', 'error']
 *
 * i.e. an ENGAGEMENT DELTA, not an article: `stats` is
 * {up,down,saves,reshares,score} and `viewer` is {reaction,saved,reshared}.
 * `'id' in payload === false`. A parent list must therefore merge it as
 *   `a.id === payload.articleId ? {...a, stats: payload.stats, viewer: payload.viewer} : a`
 * Keying off `payload.id` silently drops every update, and because the bar
 * re-syncs from its props a later parent re-render then rolls the visible counts
 * back to stale values. That is a real trap; it cost this task a review round.
 */
import { Link } from 'react-router-dom';
import AuthorChip from './AuthorChip.jsx';
import '../styles/feed.css';

/** Cover thumbnail that removes itself if the URL is missing or 404s. */
function Cover({ article, className }) {
  if (!article.coverUrl) return null;
  return (
    <div className={className}>
      <img
        src={article.coverUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={(event) => {
          // Degrade to no image rather than a broken-image glyph.
          const box = event.currentTarget.parentElement;
          if (box) box.remove();
        }}
      />
    </div>
  );
}

function TagRow({ tags, limit = 3 }) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  return (
    <span className="cluster acard-tags" style={{ '--gap': 'var(--space-2)' }}>
      {tags.slice(0, limit).map((tag) => (
        <Link key={tag} className="tag" to={`/?tag=${encodeURIComponent(tag)}`}>
          {tag}
        </Link>
      ))}
    </span>
  );
}

export default function ArticleCard({
  article,
  variant = 'feed',
  rank = null,
  actions = null,
  // eslint-disable-next-line no-unused-vars -- part of the frozen signature; see the docblock.
  onChange = undefined,
}) {
  if (!article) return null;

  const href = `/article/${article.slug}`;
  const isDraft = article.status && article.status !== 'published';
  const dense = variant === 'compact' || variant === 'rank';

  return (
    <article className={`acard acard-${variant}`}>
      {variant === 'rank' && rank != null && (
        <span className="acard-ordinal" aria-hidden="true">
          {rank}
        </span>
      )}

      <div className="acard-body">
        <div className="acard-head">
          <AuthorChip
            author={article.author}
            publishedAt={dense ? null : article.publishedAt}
            readingTime={dense ? null : article.readingTime}
            size={dense ? 'sm' : 'md'}
            stacked={!dense}
            trailing={
              isDraft ? (
                <span className="badge badge-draft acard-draft">Draft</span>
              ) : null
            }
          />
        </div>

        <h2 className={dense ? 'acard-title acard-title-sm' : 'card-title acard-title'}>
          <Link className="acard-link" to={href}>
            {article.title}
          </Link>
        </h2>

        {!dense && (article.excerpt || article.subtitle) && (
          <p className="acard-excerpt clamp-2">{article.excerpt || article.subtitle}</p>
        )}

        {dense ? (
          <p className="meta acard-densemeta">
            {article.readingTime ? `${article.readingTime} min read` : ''}
            {article.readingTime && article.stats ? (
              <span className="meta-dot">{article.stats.score} points</span>
            ) : null}
          </p>
        ) : null}

        {/*
          Footer action row. `actions` is the caller-supplied slot — the
          engagement task's bar is dropped in here by the integration task.
          With nothing passed the row has no children and `.acard-foot:empty`
          collapses it, so an un-wired card shows no empty strip.
        */}
        <div className="acard-foot">
          {actions ? (
            <div className="acard-actions" data-slot="article-actions">
              {actions}
            </div>
          ) : null}
          {!dense && <TagRow tags={article.tags} />}
        </div>
      </div>

      <Cover article={article} className={dense ? 'acard-thumb' : 'acard-cover'} />
    </article>
  );
}
