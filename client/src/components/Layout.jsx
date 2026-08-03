import { Outlet } from 'react-router-dom';
import Nav from './Nav.jsx';

export default function Layout() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <main className="app-main" id="main">
        <Outlet />
      </main>
      <footer className="footer">
        <div className="container cluster">
          <span>michigan</span>
          <span className="muted">A place to read and write things worth the time.</span>
        </div>
      </footer>
    </div>
  );
}
