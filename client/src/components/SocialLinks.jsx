/**
 * The row of social icon links under a profile header.
 *
 *   <SocialLinks user={user} />
 *
 * Renders ONLY the handles that are actually set — an empty profile renders
 * nothing at all rather than a row of dead icons. Handles are stored bare
 * ("ada", the server strips any leading "@"), so the full URL is built here in
 * one place; `website` is used verbatim because it is already a full URL.
 */

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

function XIcon() {
  // The X glyph is a solid mark rather than a stroked path.
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.53 3h3.02l-6.6 7.54L21.75 21h-5.9l-4.62-6.04L5.94 21H2.92l7.06-8.07L2.25 3h6.05l4.18 5.52L17.53 3Zm-1.06 16.18h1.67L7.6 4.73H5.81l10.66 14.45Z" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
    </svg>
  );
}

function LinkedinIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6Z" />
      <rect x="2" y="9" width="4" height="12" rx="1" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8M3.6 15h16.8" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
    </svg>
  );
}

/** Everything we know about rendering one social field, in display order. */
const CHANNELS = [
  {
    key: 'twitter',
    label: 'X',
    icon: XIcon,
    href: (handle) => `https://x.com/${encodeURIComponent(handle)}`,
    text: (handle) => `@${handle}`,
  },
  {
    key: 'github',
    label: 'GitHub',
    icon: GithubIcon,
    href: (handle) => `https://github.com/${encodeURIComponent(handle)}`,
    text: (handle) => handle,
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    icon: LinkedinIcon,
    href: (handle) => `https://linkedin.com/in/${encodeURIComponent(handle)}`,
    text: (handle) => handle,
  },
  {
    key: 'website',
    label: 'Website',
    icon: GlobeIcon,
    // Already a full http(s) URL — the server validates that on save.
    href: (value) => value,
    text: (value) => String(value).replace(/^https?:\/\//i, '').replace(/\/$/, ''),
  },
];

/** "@ada" | "ada" -> "ada". The API stores handles bare; belt and braces. */
const bare = (value) => String(value ?? '').trim().replace(/^@+/, '');

export default function SocialLinks({ user, showText = false, className = '' }) {
  if (!user) return null;

  const links = CHANNELS.map((channel) => {
    const raw = channel.key === 'website' ? String(user[channel.key] ?? '').trim() : bare(user[channel.key]);
    if (!raw) return null;
    return { ...channel, value: raw };
  }).filter(Boolean);

  if (!links.length) return null;

  return (
    <ul className={`social-links${showText ? ' social-links-text' : ''} ${className}`.trim()}>
      {links.map(({ key, label, icon: Icon, href, text, value }) => (
        <li key={key}>
          <a
            className="social-link"
            href={href(value)}
            target="_blank"
            rel="noopener noreferrer"
            title={`${label}: ${text(value)}`}
            aria-label={`${label}: ${text(value)}`}
          >
            <Icon />
            {showText ? <span className="social-link-text">{text(value)}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
