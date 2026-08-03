/**
 * PLACEHOLDER — owned by the home-feed task, which replaces this whole file.
 *
 * Deliberately kept to a stub so there is almost no merge surface when the
 * feed lands. The data it needs is already live:
 *   GET /api/articles?sort=recent|top&limit=20 -> { articles: ArticleSummary[] }
 * Link to a writer with `profilePath(username)` from ../api.js (profile URLs
 * are /@username), and to a story with `/article/${slug}`.
 */
export default function Home() {
  return (
    <div className="container-narrow section stack">
      <hr className="rule-accent" />
      <h1 className="display">Things worth the time.</h1>
      <p className="lede">
        Essays on systems, design, research and craft — written by people who had to
        learn it the slow way.
      </p>
      <p className="meta">Placeholder — the home-feed task owns this screen.</p>
    </div>
  );
}
