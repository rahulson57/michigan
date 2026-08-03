/**
 * ImageNode — the article image.
 *
 * It EXTENDS @tiptap/extension-image rather than declaring a fresh node so the
 * node keeps the name `image` and the `{src, alt, title}` attribute shape that
 * the seeded articles (server/seed.js) already store in `content_json`. Older
 * documents therefore keep rendering, and anything written here round-trips.
 *
 * Adds on top of the stock node:
 *   • caption  — rendered as <figcaption>, editable inline
 *   • width    — 'inline' | 'wide' | 'full'  (full = full-bleed)
 *   • a React node view with an empty state that uploads from the device
 *   • drag-and-drop AND paste-from-clipboard upload into the document
 *
 * Uploads go through `uploadImage()` in ../../api.js -> POST /api/uploads/image.
 */
import { useCallback, useRef, useState } from 'react';
import Image from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { uploadImage } from '../../api.js';

export const IMAGE_WIDTHS = [
  { value: 'inline', label: 'Inline', hint: 'Sits inside the text column' },
  { value: 'wide', label: 'Wide', hint: 'Breathes past the column' },
  { value: 'full', label: 'Full bleed', hint: 'Edge to edge' },
];

/* ---------------------------------------------------------------- view --- */

function ImageView({ node, updateAttributes, deleteNode, editor, selected }) {
  const { src, alt, caption, width } = node.attrs;
  const editable = editor.isEditable;
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pickFile = useCallback(
    async (file) => {
      if (!file) return;
      setBusy(true);
      setError('');
      try {
        const url = await uploadImage(file);
        updateAttributes({ src: url, alt: alt || file.name.replace(/\.[^.]+$/, '') });
      } catch (err) {
        setError(err?.message || 'That upload failed.');
      } finally {
        setBusy(false);
      }
    },
    [alt, updateAttributes],
  );

  /* Read-only: a plain figure. An image that never finished uploading renders
     nothing rather than a broken-image icon. */
  if (!editable) {
    if (!src) return null;
    return (
      <NodeViewWrapper as="figure" className="mi-figure" data-width={width || 'wide'}>
        <img src={src} alt={alt || caption || ''} loading="lazy" />
        {caption ? <figcaption>{caption}</figcaption> : null}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="figure"
      className={`mi-figure mi-node ${selected ? 'is-selected' : ''}`}
      data-width={width || 'wide'}
    >
      <div className="mi-node-chrome" contentEditable={false}>
        <span className="mi-node-handle" data-drag-handle title="Drag to move">
          ⠿
        </span>
        <span className="mi-node-kind">Image</span>
        <span className="mi-node-spacer" />
        <div className="mi-seg" role="group" aria-label="Image width">
          {IMAGE_WIDTHS.map((w) => (
            <button
              key={w.value}
              type="button"
              className={`mi-seg-btn ${(width || 'wide') === w.value ? 'is-active' : ''}`}
              onClick={() => updateAttributes({ width: w.value })}
              title={w.hint}
            >
              {w.label}
            </button>
          ))}
        </div>
        {src ? (
          <button type="button" className="mi-node-btn" onClick={() => fileRef.current?.click()}>
            Replace
          </button>
        ) : null}
        <button type="button" className="mi-node-btn is-danger" onClick={deleteNode}>
          Remove
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          pickFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {src ? (
        <img src={src} alt={alt || caption || ''} />
      ) : (
        <button
          type="button"
          className="mi-dropzone"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <span className="mi-dropzone-icon" aria-hidden="true">
            ▣
          </span>
          <span className="mi-dropzone-title">
            {busy ? 'Uploading…' : 'Choose an image'}
          </span>
          <span className="mi-dropzone-hint">…or drag one in, or paste from the clipboard</span>
        </button>
      )}

      {busy && src ? <span className="mi-node-busy">Uploading…</span> : null}
      {error ? <span className="mi-node-error">{error}</span> : null}

      {src ? (
        <figcaption>
          <input
            className="mi-caption-input"
            value={caption || ''}
            placeholder="Write a caption…"
            onChange={(event) => updateAttributes({ caption: event.target.value })}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </figcaption>
      ) : null}
    </NodeViewWrapper>
  );
}

/* ----------------------------------------------------------- extension --- */

/**
 * Where a new block should land.
 *
 * If a node is currently SELECTED (you just inserted a chart, say, so the chart
 * is the selection), a plain insert would REPLACE it. Inserting after it is what
 * a writer means. Returns undefined for a normal caret, where the default
 * insertion point is already right.
 */
function blockInsertPos(state) {
  const { selection } = state;
  return selection?.node ? selection.to : undefined;
}


/**
 * Upload every image file in `files` and insert them at `pos`.
 *
 * Two things this has to get right for a multi-file drop:
 *  • ORDER. Each insert advances the cursor past the node it just added,
 *    otherwise every image lands at the same position and the batch ends up
 *    reversed.
 *  • INDEPENDENCE. One rejected file (too large, wrong type, flaky network)
 *    must not abandon the ones behind it, so each upload gets its own try.
 */
async function insertUploads(view, files, pos, options) {
  const images = Array.from(files || []).filter((file) => file.type?.startsWith('image/'));
  if (!images.length) return false;

  options.onUploading?.(true);
  const failures = [];
  let at = pos;
  try {
    for (const file of images) {
      let url;
      try {
        // eslint-disable-next-line no-await-in-loop
        url = await uploadImage(file);
      } catch (err) {
        failures.push(err);
        continue;
      }
      const { state } = view;
      const type = state.schema.nodes.image;
      if (!type) break;
      const insertAt = Math.min(at ?? state.selection.to, state.doc.content.size);
      const node = type.create({
        src: url,
        alt: file.name.replace(/\.[^.]+$/, ''),
        width: 'wide',
        caption: '',
      });
      view.dispatch(state.tr.insert(insertAt, node).scrollIntoView());
      at = insertAt + node.nodeSize; // keep the batch in the order it was dropped
    }
  } finally {
    options.onUploading?.(false);
    if (failures.length) options.onUploadError?.(failures[0], failures.length);
  }
  return true;
}

export const ImageNode = Image.extend({
  name: 'image',
  draggable: true,

  addOptions() {
    return {
      ...this.parent?.(),
      inline: false,
      allowBase64: false,
      /** Called with true/false around an in-flight paste/drop upload. */
      onUploading: null,
      onUploadError: null,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-caption') ||
          element.querySelector?.('figcaption')?.textContent ||
          '',
        renderHTML: (attributes) =>
          attributes.caption ? { 'data-caption': attributes.caption } : {},
      },
      width: {
        default: 'wide',
        parseHTML: (element) => element.getAttribute('data-width') || 'wide',
        renderHTML: (attributes) => ({ 'data-width': attributes.width || 'wide' }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="image"]',
        getAttrs: (element) => {
          const img = element.querySelector('img');
          return {
            src: img?.getAttribute('src') || null,
            alt: img?.getAttribute('alt') || null,
            title: img?.getAttribute('title') || null,
            caption:
              element.getAttribute('data-caption') ||
              element.querySelector('figcaption')?.textContent ||
              '',
            width: element.getAttribute('data-width') || 'wide',
          };
        },
      },
      // This overrides the base extension's parseHTML entirely, so
      // `allowBase64` has to be honoured HERE or the option is dead: with it
      // off, a pasted data: URI is dropped rather than inlined into the
      // document (and from there into every autosave payload).
      { tag: this.options.allowBase64 ? 'img[src]' : 'img[src]:not([src^="data:"])' },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs = { ...HTMLAttributes };
    const width = attrs['data-width'] || 'wide';
    delete attrs['data-width'];
    delete attrs['data-caption'];

    const img = ['img', mergeAttributes(this.options.HTMLAttributes, attrs)];
    const figure = ['figure', { 'data-type': 'image', 'data-width': width, class: 'mi-figure' }];

    return node.attrs.caption
      ? [...figure, img, ['figcaption', {}, node.attrs.caption]]
      : [...figure, img];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },

  addCommands() {
    return {
      ...this.parent?.(),
      /** Insert an empty image node — its node view offers the file picker. */
      insertImagePlaceholder:
        () =>
        ({ state, commands }) => {
          const content = [
            { type: this.name, attrs: { src: '', alt: '', caption: '', width: 'wide' } },
            { type: 'paragraph' },
          ];
          const at = blockInsertPos(state);
          return at === undefined
            ? commands.insertContent(content)
            : commands.insertContentAt(at, content);
        },
    };
  },

  addProseMirrorPlugins() {
    const { options } = this;
    return [
      ...(this.parent?.() || []),
      new Plugin({
        key: new PluginKey('michiganImageUpload'),
        props: {
          handlePaste(view, event) {
            if (!view.editable) return false;
            const files = event.clipboardData?.files;
            if (!files?.length) return false;
            const images = Array.from(files).filter((f) => f.type?.startsWith('image/'));
            if (!images.length) return false;
            event.preventDefault();
            insertUploads(view, images, view.state.selection.to, options);
            return true;
          },
          handleDrop(view, event, _slice, moved) {
            if (!view.editable || moved) return false;
            const files = event.dataTransfer?.files;
            if (!files?.length) return false;
            const images = Array.from(files).filter((f) => f.type?.startsWith('image/'));
            if (!images.length) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            insertUploads(view, images, at?.pos ?? view.state.selection.to, options);
            return true;
          },
        },
      }),
    ];
  },
});

export default ImageNode;
