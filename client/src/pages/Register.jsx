import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      await register({
        name: form.name.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not create your account.');
      setBusy(false);
    }
  };

  return (
    <div className="container-narrow section">
      <div className="measure stack">
        <div className="stack stack-sm">
          <hr className="rule-accent" />
          <h1 className="page-title">Start writing.</h1>
          <p className="lede">
            An account lets you publish stories, react to what you read, and keep a
            read-later list.
          </p>
        </div>

        <form className="panel stack" onSubmit={onSubmit} noValidate>
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}

          <div className="field">
            <label className="label" htmlFor="reg-name">
              Display name
            </label>
            <input
              id="reg-name"
              className="input"
              type="text"
              autoComplete="name"
              autoFocus
              value={form.name}
              onChange={set('name')}
              placeholder="Ada Lovelace"
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="reg-username">
              Username
            </label>
            <input
              id="reg-username"
              className="input"
              type="text"
              autoComplete="username"
              value={form.username}
              onChange={set('username')}
              placeholder="adalovelace"
              required
            />
            <p className="form-hint">
              Your profile will live at michigan/@{form.username || 'username'} — letters,
              numbers and underscores, 3–30 characters.
            </p>
          </div>

          <div className="field">
            <label className="label" htmlFor="reg-email">
              Email
            </label>
            <input
              id="reg-email"
              className="input"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={set('email')}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="reg-password">
              Password
            </label>
            <input
              id="reg-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
              required
            />
            <p className="form-hint">At least 8 characters.</p>
          </div>

          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {busy ? 'Creating your account…' : 'Create account'}
          </button>

          <p className="meta text-center">
            Already have an account?{' '}
            <Link className="link" to="/login">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
