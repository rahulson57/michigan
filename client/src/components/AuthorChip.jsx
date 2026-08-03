/**
 * AuthorChip — the byline used everywhere a writer is credited.
 *
 *   <AuthorChip author={article.author} publishedAt={article.publishedAt}
 *               readingTime={article.readingTime} />
 *
 * Props
 *   author       {UserPublic}  required — `{username, name, avatarUrl, bio, …}` as
 *                              returned by the API (see toUserPublic on the server).
 *   publishedAt  {string|null} ISO timestamp. Omitted from the meta line when null
 *                              (drafts have no published_at).
 *   readingTime  {number|null} minutes. Omitted when null.
 *   size         {'sm'|'md'|'lg'} avatar size. Default 'md'.
 *   stacked      {boolean} true  → name on its own line with the meta line beneath
 *                          false → one line, "Name · 12 Mar 2026 · 6 min read"
 *   link         {boolean} wrap the name (and avatar) in a link to /@username.
 *                          Default true. Set false inside another link.
 *   trailing     {ReactNode} extra nodes appended to the meta line (e.g. a badge).
 *
 * Avatars degrade gracefully: a missing OR broken `avatarUrl` renders monogram
 * initials instead of a broken-image icon.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { profilePath } from '../api.js';
import '../styles/feed.css';

const AVATAR_CLASS = { sm: 'avatar avatar-sm', md: 'avatar', lg: 'avatar avatar-lg' };

/** "Maya Okonkwo" -> "MO"; falls back to the username, then to a bullet. */
export function initialsOf(author) {
  const source = String(author?.name || author?.username || '').trim();
  if (!source) return '·';
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]);
  return (letters.join('') || source[0]).toUpperCase();
}

/** Short, unambiguous date — "12 Mar 2026". Returns '' for null/garbage. */
export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Avatar with a monogram fallback. Exported because the profile-style author
 * card at the foot of an article needs the same behaviour at a bigger size.
 */
export function Avatar({ author, size = 'md', className = '' }) {
  const [failed, setFailed] = useState(false);
  const base = `${AVATAR_CLASS[size] || AVATAR_CLASS.md} ${className}`.trim();
  const label = author?.name || author?.username || 'Author';

  if (!author?.avatarUrl || failed) {
    return (
      <span className={`${base} avatar-monogram`} role="img" aria-label={label}>
        {initialsOf(author)}
      </span>
    );
  }

  return (
    <img
      className={base}
      src={author.avatarUrl}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export default function AuthorChip({
  author,
  publishedAt = null,
  readingTime = null,
  size = 'md',
  stacked = true,
  link = true,
  trailing = null,
}) {
  if (!author) return null;

  const displayName = author.name || author.username;
  const to = profilePath(author.username);
  const date = formatDate(publishedAt);
  const minutes = readingTime ? `${readingTime} min read` : '';

  const name = link ? (
    <Link className="author-chip-name link-quiet" to={to}>
      {displayName}
    </Link>
  ) : (
    <span className="author-chip-name">{displayName}</span>
  );

  const avatar = link ? (
    <Link to={to} tabIndex={-1} aria-hidden="true" className="author-chip-avatar">
      <Avatar author={author} size={size} />
    </Link>
  ) : (
    <Avatar author={author} size={size} />
  );

  // One-line variant: everything runs together in the meta line.
  if (!stacked) {
    return (
      <span className="author-chip author-chip-inline">
        {avatar}
        <span className="meta author-chip-text">
          {name}
          {date && <span className="meta-dot">{date}</span>}
          {minutes && <span className="meta-dot">{minutes}</span>}
          {trailing}
        </span>
      </span>
    );
  }

  return (
    <span className="author-chip">
      {avatar}
      <span className="author-chip-text">
        {name}
        <span className="meta author-chip-meta">
          {date && <span>{date}</span>}
          {date && minutes && <span className="meta-dot" />}
          {minutes && <span>{minutes}</span>}
          {trailing}
        </span>
      </span>
    </span>
  );
}
