/**
 * /settings/profile — the writer's own profile editor.
 *
 * Wrapped in <RequireAuth> by App.jsx, but `loading` from useAuth() is still
 * checked here (DEC-146): the guard renders children once hydration finishes,
 * and initialising the form from a `user` that is momentarily null would give
 * you a form full of empty strings that then overwrites a real profile.
 *
 * Text fields save through PUT /api/users/me. Images save immediately through
 * their own endpoints — an upload is not something you want to lose because
 * the writer navigated away before pressing Save. Every save calls
 * updateUser() so the nav avatar updates without a reload.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, profilePath } from '../api.js';
import { useAuth } from '../auth.jsx';
import ImageUploadField from '../components/ImageUploadField.jsx';
import SocialLinks from '../components/SocialLinks.jsx';
import '../styles/profile.css';

const BIO_LIMIT = 500;

const SOCIAL_FIELDS = [
  {
    name: 'twitter',
    label: 'X (Twitter)',
    prefix: 'x.com/',
    placeholder: 'ada',
    hint: 'Your handle, with or without the @.',
  },
  { name: 'github', label: 'GitHub', prefix: 'github.com/', placeholder: 'ada' },
  { name: 'linkedin', label: 'LinkedIn', prefix: 'linkedin.com/in/', placeholder: 'ada-lovelace' },
];

const emptyForm = { name: '', bio: '', twitter: '', github: '', linkedin: '', website: '' };

const fromUser = (user) => ({
  name: user?.name ?? '',
  bio: user?.bio ?? '',
  twitter: user?.twitter ?? '',
  github: user?.github ?? '',
  linkedin: user?.linkedin ?? '',
  website: user?.website ?? '',
});

export default function ProfileEdit() {
  const { user, loading, updateUser } = useAuth();

  const [form, setForm] = useState(emptyForm);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  // Fill the form once the session is real. Guarding on `hydrated` keeps a
  // later updateUser() from stomping on what the writer is currently typing.
  useEffect(() => {
    if (loading || !user || hydrated) return;
    setForm(fromUser(user));
    setHydrated(true);
  }, [loading, user, hydrated]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const flash = (message) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  };

  const set = (field) => (event) => {
    const { value } = event.target;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const bioLeft = BIO_LIMIT - form.bio.length;
  const bioOver = bioLeft < 0;

  // Live preview of the icon row exactly as the profile will render it.
  const previewUser = useMemo(
    () => ({
      twitter: form.twitter,
      github: form.github,
      linkedin: form.linkedin,
      website: form.website,
    }),
    [form.twitter, form.github, form.linkedin, form.website],
  );

  const uploadImage = (endpoint, field) => async (file) => {
    const body = new FormData();
    body.append('file', file);
    const { user: fresh } = await api.post(`/api/users/me/${endpoint}`, body);
    updateUser({ [field]: fresh[field] }); // nav avatar refreshes immediately
    flash(field === 'avatarUrl' ? 'Avatar updated.' : 'Cover photo updated.');
    return fresh;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setError('');

    if (bioOver) {
      setError(`Your bio is ${-bioLeft} character${bioLeft === -1 ? '' : 's'} over the limit.`);
      return;
    }

    setSaving(true);
    try {
      const { user: fresh } = await api.put('/api/users/me', {
        name: form.name,
        bio: form.bio,
        twitter: form.twitter,
        github: form.github,
        linkedin: form.linkedin,
        website: form.website,
      });
      // Re-seed from the server's normalised values ("@ada" comes back "ada").
      setForm(fromUser(fresh));
      updateUser(fresh);
      flash('Profile saved.');
    } catch (err) {
      setError(err?.message || 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="container-narrow section text-center muted" role="status">
        <span className="spinner" aria-hidden="true" style={{ margin: '0 auto' }} />
        <span className="sr-only">Loading your profile</span>
      </div>
    );
  }

  return (
    <div className="container-narrow section stack profile-edit">
      <div className="stack-sm">
        <hr className="rule-accent" />
        <h1 className="page-title">Profile settings</h1>
        <p className="lede">
          This is what readers see at{' '}
          <Link className="link" to={profilePath(user.username)}>
            /@{user.username}
          </Link>
          .
        </p>
      </div>

      {toast && (
        <div className="alert profile-toast" role="status">
          {toast}
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Images save on their own — no Save button involved. --------- */}
      <section className="panel stack profile-edit-images">
        <div className="stack-sm">
          <h2 className="section-title">Photos</h2>
          <p className="form-hint">
            PNG, JPEG, GIF, WebP or SVG, up to 8MB. Click a frame to pick a file, or drop one on
            it. Photos are saved the moment they finish uploading.
          </p>
        </div>

        <ImageUploadField
          value={user.coverUrl}
          onUpload={uploadImage('cover', 'coverUrl')}
          shape="banner"
          label="Cover photo"
          hint="Wide and calm works best — it sits behind your name."
          alt="Your cover photo"
        />

        <ImageUploadField
          value={user.avatarUrl}
          onUpload={uploadImage('avatar', 'avatarUrl')}
          shape="circle"
          label="Avatar"
          hint="Square images look best."
          alt="Your avatar"
        />
      </section>

      {/* Everything else saves together. ---------------------------- */}
      <form className="panel stack" onSubmit={onSubmit} noValidate>
        <h2 className="section-title">About you</h2>

        <div className="field">
          <label className="label" htmlFor="profile-name">
            Name
          </label>
          <input
            id="profile-name"
            className="input"
            type="text"
            value={form.name}
            onChange={set('name')}
            maxLength={80}
            autoComplete="name"
            placeholder="Ada Lovelace"
          />
          <p className="form-hint">Shown above your stories. Your handle @{user.username} never changes.</p>
        </div>

        <div className="field">
          <label className="label" htmlFor="profile-bio">
            Bio
          </label>
          <textarea
            id="profile-bio"
            className="textarea"
            rows={4}
            value={form.bio}
            onChange={set('bio')}
            aria-describedby="profile-bio-count"
            placeholder="A sentence or two about what you write and why."
          />
          <p
            id="profile-bio-count"
            className={bioOver ? 'form-error' : 'form-hint profile-counter'}
            aria-live="polite"
          >
            {bioOver
              ? `${-bioLeft} character${bioLeft === -1 ? '' : 's'} over the ${BIO_LIMIT} limit`
              : `${bioLeft} character${bioLeft === 1 ? '' : 's'} left`}
          </p>
        </div>

        <h2 className="section-title">Elsewhere</h2>

        {SOCIAL_FIELDS.map((field) => (
          <div className="field" key={field.name}>
            <label className="label" htmlFor={`profile-${field.name}`}>
              {field.label}
            </label>
            <div className="profile-prefixed">
              <span className="profile-prefix" aria-hidden="true">
                {field.prefix}
              </span>
              <input
                id={`profile-${field.name}`}
                className="input"
                type="text"
                value={form[field.name]}
                onChange={set(field.name)}
                placeholder={field.placeholder}
                autoComplete="off"
                spellCheck="false"
              />
            </div>
            {field.hint && <p className="form-hint">{field.hint}</p>}
          </div>
        ))}

        <div className="field">
          <label className="label" htmlFor="profile-website">
            Website
          </label>
          <input
            id="profile-website"
            className="input"
            type="url"
            value={form.website}
            onChange={set('website')}
            placeholder="https://example.com"
            autoComplete="url"
            spellCheck="false"
          />
          <p className="form-hint">A full URL, starting with http:// or https://.</p>
        </div>

        <div className="profile-edit-preview">
          <span className="eyebrow">Links preview</span>
          <SocialLinks user={previewUser} showText />
        </div>

        <div className="cluster profile-edit-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || bioOver}>
            {saving ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Saving…
              </>
            ) : (
              'Save profile'
            )}
          </button>
          <Link className="btn btn-ghost" to={profilePath(user.username)}>
            View profile
          </Link>
        </div>
      </form>
    </div>
  );
}
