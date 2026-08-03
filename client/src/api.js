/**
 * The single HTTP client for michigan. Every request in the app goes through
 * here so auth, error shape, and JSON parsing stay consistent.
 *
 *   import { api, uploadImage } from './api.js';
 *   const { articles } = await api.get('/api/articles?sort=top');
 *   await api.post('/api/articles', { title, contentHtml });
 *
 * Non-2xx responses throw an Error whose `message` is the server's
 * `{error: "..."}` string, and which also carries `.status` and `.body`.
 */

export const TOKEN_KEY = 'michigan_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode / storage disabled — the session just won't persist */
  }
}

export function clearToken() {
  setToken(null);
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (body instanceof FormData) {
    payload = body; // let the browser set the multipart boundary
  } else if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.', 0, null);
  }

  if (res.status === 204 || res.status === 205) return null;

  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const message =
      (parsed && parsed.error) || `Request failed (${res.status} ${res.statusText})`;
    throw new ApiError(message, res.status, parsed);
  }

  return parsed;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path, body) => request('DELETE', path, body),
};

/**
 * Upload one image and get back its public URL.
 * @param {File} file
 * @returns {Promise<string>} e.g. "/uploads/8f3c….png"
 */
export async function uploadImage(file) {
  const form = new FormData();
  form.append('file', file);
  const { url } = await api.post('/api/uploads/image', form);
  return url;
}

/* ------------------------------------------------------------------ *
 * Routing helpers — profile handles
 *
 * Profile URLs are Medium-style: `/@ada`. The router declares that route as
 * `/:username` (React Router v6 only captures a parameter when the colon
 * follows a slash, so `/@:username` would silently never match), which means
 * the captured param still carries its leading "@". Use these two helpers on
 * both sides so the "@" is handled in exactly one place.
 * ------------------------------------------------------------------ */

/** "@ada" | "ada" -> "ada". Safe on null/undefined. */
export function stripHandle(value) {
  return String(value ?? '').replace(/^@+/, '');
}

/** "ada" | "@ada" -> "/@ada" — the canonical link target for a profile. */
export function profilePath(username) {
  return `/@${encodeURIComponent(stripHandle(username))}`;
}

export default api;
