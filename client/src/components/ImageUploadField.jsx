/**
 * Pick an image from the device — by click or by drag-and-drop — and hand the
 * File to the caller.
 *
 *   <ImageUploadField
 *     value={user.avatarUrl}                     // current image, may be null
 *     onUpload={(file) => api.post(…, form)}     // must return a Promise
 *     shape="circle" | "banner"
 *     label="Avatar"
 *   />
 *
 * The preview switches to a local object URL the instant a file is chosen, so
 * the new image is on screen before the request resolves; if the upload fails
 * the preview rolls back to `value` and the error is shown inline. The same
 * guards the server enforces (image/* only, 8MB) run here first so an obvious
 * mistake never costs a round trip.
 *
 * `variant="overlay"` is the compact form used for hover-to-change controls
 * directly on the profile header.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import '../styles/profile.css';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // matches server/uploads.js

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

/** null when the file is acceptable, otherwise the message to show. */
export function validateImage(file) {
  if (!file) return 'Choose an image file.';
  if (!/^image\//i.test(file.type || '')) return 'That file is not an image — pick a PNG, JPEG, GIF, WebP or SVG.';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 8MB.`;
  }
  return null;
}

function CameraIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 7h3l1.6-2h6.8L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

export default function ImageUploadField({
  value = null,
  onUpload,
  shape = 'banner',
  label = 'Image',
  hint = '',
  variant = 'field',
  disabled = false,
  alt = '',
}) {
  const inputRef = useRef(null);
  const previewRef = useRef(null); // the object URL currently on screen
  const inputId = useId();

  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  // Never leak an object URL — revoke the previous one whenever it changes and
  // once more on unmount.
  const setLocalPreview = useCallback((file) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = file ? URL.createObjectURL(file) : null;
    setPreview(previewRef.current);
  }, []);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const handleFile = useCallback(
    async (file) => {
      const problem = validateImage(file);
      if (problem) {
        setError(problem);
        return;
      }
      setError('');
      setLocalPreview(file);
      setBusy(true);
      try {
        await onUpload(file);
        // The parent now owns the persisted URL — drop the local preview so
        // `value` is the single source of truth again.
        setLocalPreview(null);
      } catch (err) {
        setLocalPreview(null);
        setError(err?.message || 'Upload failed. Try again.');
      } finally {
        setBusy(false);
      }
    },
    [onUpload, setLocalPreview],
  );

  const onInputChange = (event) => {
    const file = event.target.files?.[0];
    // Reset so choosing the SAME file twice still fires a change event.
    event.target.value = '';
    if (file) handleFile(file);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (disabled || busy) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  };

  const onDragOver = (event) => {
    event.preventDefault();
    if (!disabled && !busy) setDragging(true);
  };

  const open = () => {
    if (!disabled && !busy) inputRef.current?.click();
  };

  const shown = preview || value || null;
  const isOverlay = variant === 'overlay';
  const classes = [
    'upload',
    `upload-${shape}`,
    isOverlay ? 'upload-overlay' : 'upload-field',
    dragging ? 'is-dragging' : '',
    busy ? 'is-busy' : '',
    disabled ? 'is-disabled' : '',
    shown ? 'has-image' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const actionText = shown ? `Change ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`;

  return (
    <div className={isOverlay ? 'upload-wrap upload-wrap-overlay' : 'upload-wrap field'}>
      {!isOverlay && (
        <label className="label" htmlFor={inputId}>
          {label}
        </label>
      )}

      <button
        type="button"
        id={isOverlay ? undefined : inputId}
        className={classes}
        onClick={open}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={() => setDragging(false)}
        disabled={disabled || busy}
        aria-label={`${actionText}. Click to choose a file, or drop one here.`}
        aria-busy={busy}
      >
        {shown ? (
          <img className="upload-preview" src={shown} alt={alt} />
        ) : (
          <span className="upload-placeholder" aria-hidden="true">
            <CameraIcon />
          </span>
        )}

        <span className="upload-veil">
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" />
              <span className="upload-veil-text">Uploading…</span>
            </>
          ) : (
            <>
              <CameraIcon />
              {!isOverlay && (
                <span className="upload-veil-text">
                  {dragging ? 'Drop to upload' : `${actionText} — click or drop`}
                </span>
              )}
            </>
          )}
        </span>

        {busy && <span className="upload-progress" aria-hidden="true" />}
      </button>

      <input
        ref={inputRef}
        id={isOverlay ? inputId : undefined}
        className="sr-only"
        type="file"
        accept={ACCEPT}
        onChange={onInputChange}
        disabled={disabled || busy}
        tabIndex={-1}
      />

      {!isOverlay && hint && !error && <p className="form-hint">{hint}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <span className="sr-only" role="status">
        {busy ? `Uploading ${label.toLowerCase()}` : ''}
      </span>
    </div>
  );
}
