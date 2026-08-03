import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth.jsx';
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
            <Route path="/@:username" element={<Profile />} />
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
