/**
 * A writer's public page — /@ada.
 *
 * ⚠️ `username` arrives as a PROP, already stripped of the leading "@"
 * (DEC-146). The route is declared `/:handle` in App.jsx because React Router
 * v6 only captures a parameter when the colon follows a slash, so useParams()
 * here would give you `handle` — WITH the "@" — or nothing at all. Read the
 * prop.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, profilePath } from '../api.js';
import { useAuth } from '../auth.jsx';
import ImageUploadField from '../components/ImageUploadField.jsx';
import SocialLinks from '../components/SocialLinks.jsx';
import '../styles/profile.css';

/* ------------------------------------------------------------------ *
 * The feed card
 *
 * <ArticleCard> is owned by the home-feed task. It may not exist yet in this
 * worktree, and a bare `import` of a missing module fails the build — so it is
 * resolved through import.meta.glob, which yields {} instead of throwing when
 * nothing matches. The day that file lands, every card on this page becomes
 * the real one with no edit here; until then the local fallback below renders
 * the same ArticleSummary shape.
 * ------------------------------------------------------------------ */
const cardModules = import.meta.glob('../components/ArticleCard.jsx', { eager: true });
const SharedArticleCard = cardModules['../components/ArticleCard.jsx']?.default ?? null;

function formatDate(value, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, opts);
}

function FallbackArticleCard({ article }) {
  if (!article) return null;
  const { author } = article;
  return (
    <article className="card profile-card">
      <div className="profile-card-body">
        <div className="cluster profile-card-byline">
          {author?.avatarUrl ? (
            <img className="avatar avatar-sm" src={author.avatarUrl} alt="" />
          ) : (
            <span className="avatar avatar-sm" aria-hidden="true" />
          )}
          <Link className="link-quiet" to={profilePath(author?.username)}>
            {author?.name || `@${author?.username}`}
          </Link>
          {article.publishedAt && (
            <span className="meta meta-dot">{formatDate(article.publishedAt)}</span>
          )}
          {article.status !== 'published' && <span className="badge badge-draft">Draft</span>}
        </div>

        <h3 className="card-title">
          <Link className="link-quiet" to={`/article/${article.slug}`}>
            {article.title}
          </Link>
        </h3>

        {article.subtitle && <p className="lede profile-card-subtitle">{article.subtitle}</p>}
        {article.excerpt && <p className="muted clamp-2">{article.excerpt}</p>}

        <p className="meta profile-card-meta">
          <span>{article.readingTime || 1} min read</span>
          <span className="meta-dot">{article.stats?.up ?? 0} up</span>
          <span className="meta-dot">{article.stats?.reshares ?? 0} reshares</span>
        </p>
      </div>

      {article.coverUrl && (
        <Link
          className="profile-card-cover"
          to={`/article/${article.slug}`}
          tabIndex={-1}
          aria-hidden="true"
        >
          <img src={article.coverUrl} alt="" loading="lazy" />
        </Link>
      )}
    </article>
  );
}

const ArticleCard = SharedArticleCard || FallbackArticleCard;

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

const TABS = [
  { key: 'articles', label: 'Articles' },
  { key: 'reshares', label: 'Reshares' },
  { key: 'drafts', label: 'Drafts', ownerOnly: true },
];

function emptyTitle(tab, isOwner, displayName) {
  if (tab === 'reshares') {
    return isOwner
      ? 'You haven’t reshared anything yet.'
      : `${displayName} hasn’t reshared anything yet.`;
  }
  if (tab === 'drafts') return 'No drafts in progress.';
  return isOwner
    ? 'You haven’t published a story yet.'
    : `${displayName} hasn’t published anything yet.`;
}

export default function Profile({ username }) {
  const { user: viewer, updateUser } = useAuth();

  const [profile, setProfile] = useState(null); // {user, stats}
  const [status, setStatus] = useState('loading'); // loading | ready | missing | error
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('articles');

  const [articles, setArticles] = useState(null);
  const [reshares, setReshares] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [tabError, setTabError] = useState('');

  const base = `/api/users/${encodeURIComponent(username || '')}`;
  const isOwner = Boolean(viewer && profile?.user && viewer.id === profile.user.id);

  // Header — reloaded whenever the handle in the URL changes.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setLoadError('');
    setProfile(null);
    setArticles(null);
    setReshares(null);
    setDrafts(null);
    setTab('articles');

    (async () => {
      try {
        const data = await api.get(base);
        if (cancelled) return;
        setProfile(data);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        if (err?.status === 404) {
          setStatus('missing');
        } else {
          setLoadError(err?.message || 'Could not load this profile.');
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [base]);

  // Tab contents — fetched once each, then cached for the rest of the visit.
  useEffect(() => {
    if (status !== 'ready') return undefined;
    if (tab === 'articles' && articles) return undefined;
    if (tab === 'reshares' && reshares) return undefined;
    if (tab === 'drafts' && (drafts || !isOwner)) return undefined;

    let cancelled = false;
    setTabError('');
    (async () => {
      try {
        if (tab === 'articles') {
          const data = await api.get(`${base}/articles`);
          if (!cancelled) setArticles(data.articles || []);
        } else if (tab === 'reshares') {
          const data = await api.get(`${base}/reshares`);
          if (!cancelled) setReshares(data.reshares || []);
        } else if (tab === 'drafts') {
          const data = await api.get(`${base}/articles?status=draft`);
          if (!cancelled) setDrafts(data.articles || []);
        }
      } catch (err) {
        if (!cancelled) setTabError(err?.message || 'Could not load that list.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab, status, base, isOwner, articles, reshares, drafts]);

  /** Owner-only inline avatar/cover change, straight from the header. */
  const uploadTo = useCallback(
    (endpoint, field) => async (file) => {
      const form = new FormData();
      form.append('file', file);
      const { user: fresh } = await api.post(`/api/users/me/${endpoint}`, form);
      setProfile((prev) => (prev ? { ...prev, user: fresh } : prev));
      updateUser({ [field]: fresh[field] }); // nav avatar updates without a reload
      return fresh;
    },
    [updateUser],
  );

  const onAvatar = useMemo(() => uploadTo('avatar', 'avatarUrl'), [uploadTo]);
  const onCover = useMemo(() => uploadTo('cover', 'coverUrl'), [uploadTo]);

  if (status === 'loading') {
    return (
      <div className="profile-page" aria-busy="true">
        <div className="profile-cover skeleton" />
        <div className="container profile-shell">
          <div className="skeleton profile-skeleton-avatar" />
          <div className="stack">
            <div className="skeleton" style={{ height: '2rem', width: 'min(18rem, 70%)' }} />
            <div className="skeleton" style={{ height: '1rem', width: 'min(30rem, 90%)' }} />
          </div>
        </div>
        <span className="sr-only" role="status">
          Loading profile
        </span>
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="container-narrow section stack text-center">
        <p className="eyebrow">404</p>
        <h1 className="page-title">No writer called @{username}</h1>
        <p className="muted">
          That handle doesn&apos;t belong to anyone here. It may have been changed, or the link may
          be wrong.
        </p>
        <div className="cluster" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-primary" to="/">
            Back to the home feed
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="container-narrow section stack">
        <div className="alert alert-error" role="alert">
          {loadError}
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  const { user, stats } = profile;
  const displayName = user.name || `@${user.username}`;
  const visibleTabs = TABS.filter((t) => !t.ownerOnly || isOwner);
  const lists = { articles, reshares, drafts };
  const current = lists[tab];

  return (
    <div className="profile-page">
      {/* Cover ------------------------------------------------------- */}
      <div className={`profile-cover${user.coverUrl ? '' : ' profile-cover-empty'}`}>
        {user.coverUrl && <img className="profile-cover-img" src={user.coverUrl} alt="" />}
        {isOwner && (
          <div className="profile-cover-edit">
            <ImageUploadField
              value={null}
              onUpload={onCover}
              shape="banner"
              label="Cover"
              variant="overlay"
            />
          </div>
        )}
      </div>

      <div className="container profile-shell">
        {/* Identity -------------------------------------------------- */}
        <header className="profile-header">
          <div className="profile-avatar-wrap">
            {user.avatarUrl ? (
              <img
                className="avatar avatar-xl profile-avatar"
                src={user.avatarUrl}
                alt={displayName}
              />
            ) : (
              <span className="avatar avatar-xl profile-avatar" aria-hidden="true" />
            )}
            {isOwner && (
              <div className="profile-avatar-edit">
                <ImageUploadField
                  value={null}
                  onUpload={onAvatar}
                  shape="circle"
                  label="Avatar"
                  variant="overlay"
                />
              </div>
            )}
          </div>

          <div className="profile-identity">
            <div className="profile-name-row">
              <h1 className="page-title profile-name">{displayName}</h1>
              {isOwner && (
                <Link className="btn btn-ghost btn-sm profile-edit-btn" to="/settings/profile">
                  Edit profile
                </Link>
              )}
            </div>

            <p className="profile-handle">@{user.username}</p>

            {user.bio && <p className="lede profile-bio">{user.bio}</p>}

            <div className="profile-meta-row">
              <p className="meta profile-stats">
                <span>
                  <strong>{stats?.articles ?? 0}</strong>{' '}
                  {stats?.articles === 1 ? 'story' : 'stories'}
                </span>
                <span className="meta-dot">
                  <strong>{stats?.totalUp ?? 0}</strong> thumbs up
                </span>
                <span className="meta-dot">
                  <strong>{stats?.totalReshares ?? 0}</strong> reshares
                </span>
                {user.createdAt && (
                  <span className="meta-dot">
                    Joined {formatDate(user.createdAt, { month: 'long', year: 'numeric' })}
                  </span>
                )}
              </p>
              <SocialLinks user={user} />
            </div>
          </div>
        </header>

        <hr className="divider" />

        {/* Tabs ------------------------------------------------------ */}
        <div className="profile-tabs" role="tablist" aria-label={`${displayName}'s writing`}>
          {visibleTabs.map((t) => {
            const count =
              t.key === 'articles' ? stats?.articles : t.key === 'reshares' ? stats?.reshares : stats?.drafts;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`profile-tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls="profile-tabpanel"
                className={`profile-tab${tab === t.key ? ' is-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {count ? <span className="profile-tab-count">{count}</span> : null}
              </button>
            );
          })}
        </div>

        <div
          className="profile-list stack"
          role="tabpanel"
          id="profile-tabpanel"
          aria-labelledby={`profile-tab-${tab}`}
        >
          {tabError && (
            <div className="alert alert-error" role="alert">
              {tabError}
            </div>
          )}

          {!tabError && current === null && (
            <>
              <div className="skeleton profile-skeleton-row" />
              <div className="skeleton profile-skeleton-row" />
              <span className="sr-only" role="status">
                Loading stories
              </span>
            </>
          )}

          {!tabError && current && current.length === 0 && (
            <div className="empty">
              <p className="section-title">{emptyTitle(tab, isOwner, displayName)}</p>
              {tab === 'drafts' && isOwner && (
                <Link className="btn btn-primary" to="/write">
                  Start a story
                </Link>
              )}
            </div>
          )}

          {!tabError &&
            current &&
            current.length > 0 &&
            (tab === 'reshares'
              ? current.map((reshare) => (
                  <div className="profile-reshare" key={`reshare-${reshare.id}`}>
                    <div className="profile-reshare-byline">
                      {/* Sentence case on purpose: .eyebrow uppercases, and a
                          person's name should not be shouted. */}
                      <p className="meta profile-reshare-label">
                        {user.avatarUrl ? (
                          <img className="avatar avatar-sm" src={user.avatarUrl} alt="" />
                        ) : null}
                        <span>
                          <strong>{displayName}</strong> reshared
                          {reshare.createdAt ? ` · ${formatDate(reshare.createdAt)}` : ''}
                        </span>
                      </p>
                      {reshare.comment && (
                        <blockquote className="profile-reshare-comment">
                          {reshare.comment}
                        </blockquote>
                      )}
                    </div>
                    <ArticleCard article={reshare.article} />
                  </div>
                ))
              : current.map((article) => <ArticleCard key={article.id} article={article} />))}
        </div>
      </div>
    </div>
  );
}
