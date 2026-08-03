/**
 * Session state for michigan.
 *
 *   const { user, token, loading, login, register, logout, refresh, updateUser } = useAuth();
 *
 * `user` is a UserPublic object or null. `loading` is true only during the
 * initial hydration from localStorage — guard redirects on it so a refresh
 * does not bounce a signed-in reader to /login. `loading` is part of the
 * ratified contract (DEC-146); the hydration guard cannot be written without
 * it, so do not drop it from this return shape.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, getToken, setToken as persistToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => getToken());
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const applySession = useCallback((nextToken, nextUser) => {
    persistToken(nextToken);
    setTokenState(nextToken);
    setUser(nextUser);
  }, []);

  /** Re-read the current user from the server. */
  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return null;
    }
    try {
      const data = await api.get('/api/auth/me');
      const fresh = (data && data.user) || null;
      // A 2xx with no user in the body is a transient blip (proxy hiccup, empty
      // response), NOT a sign-out. Blanking `user` here would log out a reader
      // who still holds a perfectly valid token, so keep the cached session.
      if (!fresh) return null;
      setUser(fresh);
      return fresh;
    } catch (err) {
      // Only an explicit 401 — the server rejecting the token — ends the
      // session. Network failures, timeouts and 5xx leave both the token and
      // the cached user intact so a flaky moment can't sign anyone out.
      if (err.status === 401) applySession(null, null);
      return null;
    }
  }, [applySession]);

  // Hydrate once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(
    async (email, password) => {
      const { token: nextToken, user: nextUser } = await api.post('/api/auth/login', {
        email,
        password,
      });
      applySession(nextToken, nextUser);
      return nextUser;
    },
    [applySession],
  );

  const register = useCallback(
    async ({ username, email, password, name }) => {
      const { token: nextToken, user: nextUser } = await api.post('/api/auth/register', {
        username,
        email,
        password,
        name,
      });
      applySession(nextToken, nextUser);
      return nextUser;
    },
    [applySession],
  );

  const logout = useCallback(() => {
    applySession(null, null);
  }, [applySession]);

  /** Merge fields into the cached user — call after a profile save. */
  const updateUser = useCallback((partial) => {
    setUser((prev) => (prev ? { ...prev, ...partial } : prev));
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, login, register, logout, refresh, updateUser }),
    [user, token, loading, login, register, logout, refresh, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Route guard. Sends signed-out visitors to /login and remembers where they were. */
export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="container section text-center muted" role="status">
        <span className="spinner" aria-hidden="true" style={{ margin: '0 auto' }} />
        <span className="sr-only">Loading your session</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

export default AuthProvider;
