import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = location.state?.from?.pathname || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err.message || 'Could not sign you in.');
      setBusy(false);
    }
  };

  return (
    <div className="container-narrow section">
      <div className="measure stack">
        <div className="stack stack-sm">
          <hr className="rule-accent" />
          <h1 className="page-title">Welcome back.</h1>
          <p className="lede">Sign in to read, save, and publish on michigan.</p>
        </div>

        <form className="panel stack" onSubmit={onSubmit} noValidate>
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}

          <div className="field">
            <label className="label" htmlFor="login-email">
              Email or username
            </label>
            <input
              id="login-email"
              className="input"
              type="text"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="meta text-center">
            New here?{' '}
            <Link className="link" to="/register">
              Create an account
            </Link>
          </p>
        </form>

        <div className="card stack stack-sm">
          <p className="eyebrow">Demo accounts</p>
          <p className="meta">
            Every seeded writer uses the password <code>password123</code>. Try{' '}
            <button
              type="button"
              className="link"
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
              onClick={() => {
                setEmail('maya@michigan.dev');
                setPassword('password123');
              }}
            >
              maya@michigan.dev
            </button>{' '}
            to fill the form.
          </p>
        </div>
      </div>
    </div>
  );
}
