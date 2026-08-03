/**
 * PLACEHOLDER — owned by the profiles task, which replaces this whole file.
 * The route is already wired in client/src/App.jsx; nothing outside this file
 * needs to change for the real page to light up.
 *
 * `username` arrives as a PROP, already stripped of the "@" from the /@ada URL
 * (DEC-146) — read it here rather than useParams(), whose `handle` param still
 * carries the "@". Fetch with: GET /api/profiles/${username}.
 */
export default function Profile({ username }) {
  return (
    <div className="container-narrow section stack">
      <hr className="rule-accent" />
      <h1 className="page-title">@{username}</h1>
      <p className="lede">A writer&apos;s cover, bio, social links, and their published stories.</p>
      <p className="meta">Placeholder — the profiles task owns this screen.</p>
    </div>
  );
}
