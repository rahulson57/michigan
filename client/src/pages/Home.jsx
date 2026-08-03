/**
 * PLACEHOLDER — owned by the home-feed task, which replaces this whole file.
 *
 * It renders a real (if plain) feed so the foundation is demonstrably working
 * end to end, and so the next agent has a worked example of the design-system
 * classes: .container .stack .card .avatar .tag .meta .eyebrow .rule-accent.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ArticleRow({ article }) {
  return (
    <article className="card card-interactive stack stack-sm">
      <div className="row">
        {article.author.avatarUrl && (
          <img className="avatar avatar-sm" src={article.author.avatarUrl} alt="" />
        )}
        <Link className="link-quiet meta" to={`/@${article.author.username}`}>
          {article.author.name || article.author.username}
        </Link>
        <span className="meta meta-dot">{formatDate(article.publishedAt)}</span>
      </div>

      <Link className="link-quiet" to={`/article/${article.slug}`}>
        <h2 className="card-title">{article.title}</h2>
      </Link>

      {article.subtitle && <p className="muted clamp-2">{article.subtitle}</p>}

      <div className="cluster">
        <span className="meta">{article.readingTime} min read</span>
        <span className="meta meta-dot">{article.stats.score} points</span>
        <span className="meta meta-dot">{article.stats.saves} saved</span>
        <span className="spacer" />
        {article.tags?.slice?.(0, 2).map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}

export default function Home() {
  const [articles, setArticles] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/articles?sort=recent&limit=20')
      .then((data) => {
        if (cancelled) return;
        setArticles(data.articles);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="container stack stack-lg">
      <header className="stack stack-sm">
        <hr className="rule-accent" />
        <h1 className="display">Things worth the time.</h1>
        <p className="lede">
          Essays on systems, design, research and craft — written by people who had to
          learn it the slow way.
        </p>
      </header>

      {status === 'loading' && (
        <div className="stack" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div className="card stack stack-sm" key={i}>
              <div className="skeleton" style={{ height: 14, width: '30%' }} />
              <div className="skeleton" style={{ height: 26, width: '70%' }} />
              <div className="skeleton" style={{ height: 14, width: '50%' }} />
            </div>
          ))}
        </div>
      )}

      {status === 'error' && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      {status === 'ready' && articles.length === 0 && (
        <div className="empty">
          <p>Nothing published yet.</p>
          <Link className="btn btn-primary" to="/write">
            Write the first story
          </Link>
        </div>
      )}

      {status === 'ready' && articles.length > 0 && (
        <div className="stack">
          {articles.map((article) => (
            <ArticleRow key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
