import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const PRIMARY_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/read-later', label: 'Read later' },
];

function PencilIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function AvatarMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="avatar-menu" ref={wrapRef}>
      <button
        type="button"
        className="avatar-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name || user.username}`}
        onClick={() => setOpen((v) => !v)}
      >
        {user.avatarUrl ? (
          <img className="avatar" src={user.avatarUrl} alt="" />
        ) : (
          <span className="avatar" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="menu" role="menu">
          <div className="menu-header">
            <div style={{ fontWeight: 600 }}>{user.name || user.username}</div>
            <div className="meta">@{user.username}</div>
          </div>
          <div className="menu-separator" />
          <Link className="menu-item" role="menuitem" to={`/@${user.username}`} onClick={() => setOpen(false)}>
            Your profile
          </Link>
          <Link className="menu-item" role="menuitem" to="/write" onClick={() => setOpen(false)}>
            New story
          </Link>
          <Link className="menu-item" role="menuitem" to="/read-later" onClick={() => setOpen(false)}>
            Read later
          </Link>
          <Link className="menu-item" role="menuitem" to="/settings/profile" onClick={() => setOpen(false)}>
            Profile settings
          </Link>
          <div className="menu-separator" />
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const signOut = () => {
    logout();
    navigate('/');
  };

  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link to="/" className="wordmark" aria-label="michigan — home">
          michigan
        </Link>

        <nav className="nav-links" aria-label="Primary">
          {PRIMARY_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav-actions">
          {user ? (
            <>
              <Link to="/write" className="btn btn-ghost">
                <PencilIcon />
                <span className="nav-write-label">Write</span>
              </Link>
              <AvatarMenu user={user} onSignOut={signOut} />
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost">
                Sign in
              </Link>
              <Link to="/register" className="btn btn-primary">
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
