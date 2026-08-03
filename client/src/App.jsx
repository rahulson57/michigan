import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth.jsx';
import { stripHandle } from './api.js';
import Layout from './components/Layout.jsx';

// Owned by the feature tasks — see client/src/pages/.
import Home from './pages/Home.jsx';
import ArticleView from './pages/ArticleView.jsx';
import EditorPage from './pages/EditorPage.jsx';
import Profile from './pages/Profile.jsx';
import ProfileEdit from './pages/ProfileEdit.jsx';
import ReadLater from './pages/ReadLater.jsx';
import Leaderboard from './pages/Leaderboard.jsx';

// Owned by the foundation task.
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';

function NotFound() {
  return (
    <div className="container-narrow section stack text-center">
      <p className="eyebrow">404</p>
      <h1 className="page-title">We couldn&apos;t find that page.</h1>
      <p className="muted">The link may be broken, or the story may have been unpublished.</p>
      <div className="cluster" style={{ justifyContent: 'center' }}>
        <a className="btn btn-primary" href="/">
          Back to the home feed
        </a>
      </div>
    </div>
  );
}

/**
 * Medium-style profile URLs are `/@username` (see `profilePath()` in api.js).
 *
 * ⚠️ READ THIS BEFORE TOUCHING THE PROFILE ROUTE. React Router v6 only turns
 * `:name` into a parameter when the colon immediately follows a slash — its
 * path compiler matches on /\/:([\w-]+)/. That means `path="/@:username"` is
 * NOT a dynamic route: it compiles to the literal string "/@:username",
 * silently never matches, and every profile link falls through to the `*`
 * NotFound route. No warning is emitted.
 *
 * So the route is declared as `/:username` — a whole dynamic segment — and the
 * captured value KEEPS its leading "@" (e.g. "@ada"). `stripHandle()` turns it
 * back into a bare username. Static routes (`/login`, `/write`, `/leaderboard`,
 * …) still win because v6 ranks static segments above dynamic ones.
 *
 * The param is deliberately named `handle` (not `username`) because its value
 * still has the "@" on it — Profile.jsx receives the STRIPPED value as a
 * `username` prop and should read that, per DEC-146, rather than useParams().
 */
function ProfileRoute() {
  const { handle = '' } = useParams();
  // Only "/@something" is a profile URL. Anything else is a real 404, exactly
  // as it was before this single-segment route existed.
  if (!handle.startsWith('@') || handle.length < 2) return <NotFound />;
  return <Profile username={stripHandle(handle)} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/article/:slug" element={<ArticleView />} />
            <Route
              path="/write"
              element={
                <RequireAuth>
                  <EditorPage />
                </RequireAuth>
              }
            />
            <Route
              path="/write/:id"
              element={
                <RequireAuth>
                  <EditorPage />
                </RequireAuth>
              }
            />
            {/* /@username — see ProfileRoute above for why this is "/:handle". */}
            <Route path="/:handle" element={<ProfileRoute />} />
            <Route
              path="/settings/profile"
              element={
                <RequireAuth>
                  <ProfileEdit />
                </RequireAuth>
              }
            />
            <Route
              path="/read-later"
              element={
                <RequireAuth>
                  <ReadLater />
                </RequireAuth>
              }
            />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/signin" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
