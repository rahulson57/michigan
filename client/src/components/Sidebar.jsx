/**
 * Sidebar — the right-hand rail on the home feed.
 *
 *   <Sidebar activeTag={tag} onSelectTag={setTag} />
 *
 * Shows "Trending on michigan" (the top five stories by score) and "Discover
 * more topics" (a tag cloud that filters the feed), plus a link through to the
 * leaderboard. It is a desktop-only affordance — feed.css hides it below 900px,
 * and it fetches its own data so the feed page stays about the feed.
 *
 * Props
 *   activeTag    {string|null}         the tag the feed is currently filtered by
 *   onSelectTag  {(tag|null) => void}  called when a topic is clicked; passing the
 *                                      active tag again clears the filter
 *
 * ── On the topic list ────────────────────────────────────────────────────────
 * `GET /api/articles` returns ArticleSummary, which by frozen contract carries
 * no `tags` array (only ArticleFull does). There is no `/api/tags` endpoint, so
 * the vocabulary here is harvested by reading a bounded sample of articles in
 * full, once per page load, and counting their tags. Results are memoised at
 * module scope so navigating back to the feed does not refetch.
 *
 * A `GET /api/tags` endpoint returning `{name, count}[]` would replace this
 * entirely; it has been flagged to the coordinator as a follow-up rather than
 * added here, because the server routes are outside this task's file scope.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import '../styles/feed.css';

/** How many articles to read in full when harvesting the topic vocabulary. */
const TOPIC_SAMPLE = 10;
const TOPIC_LIMIT = 14;

let topicCache = null; // [{name, count}] — session-lifetime memo
let trendingCache = null; // ArticleSummary[]

async function fetchTrending() {
  if (trendingCache) return trendingCache;
  const { articles } = (await api.get('/api/articles?sort=top&limit=5&offset=0')) || {};
  trendingCache = Array.isArray(articles) ? articles : [];
  return trendingCache;
}

async function fetchTopics() {
  if (topicCache) return topicCache;

  // A spread of both rankings so the cloud is not just whatever is popular.
  const [top, recent] = await Promise.all([
    api.get('/api/articles?sort=top&limit=8&offset=0').catch(() => null),
    api.get('/api/articles?sort=recent&limit=8&offset=0').catch(() => null),
  ]);

  const slugs = [];
  for (const list of [top, recent]) {
    for (const article of list?.articles || []) {
      if (article?.slug && !slugs.includes(article.slug)) slugs.push(article.slug);
    }
  }

  const sampled = await Promise.all(
    slugs.slice(0, TOPIC_SAMPLE).map((slug) =>
      api.get(`/api/articles/${encodeURIComponent(slug)}`).catch(() => null),
    ),
  );

  const counts = new Map();
  for (const article of sampled) {
    for (const tag of article?.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  topicCache = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOPIC_LIMIT);

  return topicCache;
}

function TrendingRow({ article, index }) {
  return (
    <li className="trend-item">
      <span className="trend-rank" aria-hidden="true">
        {String(index + 1).padStart(2, '0')}
      </span>
      <span className="trend-body">
        <Link className="trend-title link-quiet" to={`/article/${article.slug}`}>
          {article.title}
        </Link>
        <span className="meta trend-meta">
          {article.author?.name || article.author?.username}
          <span className="meta-dot">{article.stats?.score ?? 0} points</span>
        </span>
      </span>
    </li>
  );
}

export default function Sidebar({ activeTag = null, onSelectTag = () => {} }) {
  const [trending, setTrending] = useState(null);
  const [topics, setTopics] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchTrending()
      .then((list) => alive && setTrending(list))
      .catch(() => alive && setTrending([]));
    fetchTopics()
      .then((list) => alive && setTopics(list))
      .catch(() => alive && setTopics([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <aside className="feed-rail" aria-label="Trending and topics">
      <div className="rail-sticky stack">
        <section className="stack stack-sm">
          <h2 className="rail-title">Trending on michigan</h2>
          {trending === null ? (
            <ul className="rail-list stack stack-sm" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="trend-item">
                  <span className="skeleton sk-line" style={{ width: '100%' }} />
                </li>
              ))}
            </ul>
          ) : trending.length === 0 ? (
            <p className="meta">Nothing trending yet.</p>
          ) : (
            <ol className="rail-list stack stack-sm">
              {trending.map((article, index) => (
                <TrendingRow key={article.id} article={article} index={index} />
              ))}
            </ol>
          )}
          <Link className="link rail-link" to="/leaderboard">
            See the full leaderboard →
          </Link>
        </section>

        <hr className="divider" />

        <section className="stack stack-sm">
          <h2 className="rail-title">Discover more topics</h2>
          {topics === null ? (
            <div className="cluster" aria-hidden="true">
              {[64, 88, 72, 96, 60, 80].map((width, i) => (
                <span key={i} className="skeleton sk-chip" style={{ width }} />
              ))}
            </div>
          ) : topics.length === 0 ? (
            <p className="meta">No topics yet.</p>
          ) : (
            <div className="cluster" style={{ '--gap': 'var(--space-2)' }}>
              {topics.map(({ name }) => (
                <button
                  key={name}
                  type="button"
                  className={`tag tag-button${name === activeTag ? ' is-active' : ''}`}
                  aria-pressed={name === activeTag}
                  onClick={() => onSelectTag(name === activeTag ? null : name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </section>

        <hr className="divider" />

        <p className="meta rail-foot">
          michigan — a place to read and write things worth the time.
        </p>
      </div>
    </aside>
  );
}
