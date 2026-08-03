/**
 * RichEditor — the writing surface.
 *
 *   <RichEditor value={json} onChange={({json, html, text}) => …} />
 *
 * `value` is a TipTap document (the article's `contentJson`). Every keystroke
 * emits all three representations at once so the page can autosave `contentJson`
 * and `contentHtml` together and never let them drift apart.
 *
 * Extensions come from ./extensions.js — the same registry the reader uses.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { EMPTY_DOC, buildExtensions } from './extensions.js';
import Toolbar, { runInsert } from './Toolbar.jsx';
import BubbleMenuBar from './BubbleMenuBar.jsx';
import '../styles/editor.css';

/** The slash palette. `key` is dispatched through runInsert() in Toolbar.jsx. */
const SLASH_ITEMS = [
  { key: 'heading2', label: 'Heading', hint: 'Section title', glyph: 'H2', terms: 'h2 heading title' },
  { key: 'heading3', label: 'Subheading', hint: 'Smaller title', glyph: 'H3', terms: 'h3 subheading' },
  { key: 'image', label: 'Image', hint: 'Upload from your device', glyph: '▣', terms: 'image photo picture upload' },
  { key: 'table', label: 'Table', hint: '3 × 3 with a header row', glyph: '▦', terms: 'table grid' },
  { key: 'chart', label: 'Chart', hint: 'Line, bar, area or pie', glyph: '◔', terms: 'chart graph data plot' },
  { key: 'timeline', label: 'Timeline', hint: 'Interactive, expandable', glyph: '⋮', terms: 'timeline history events' },
  { key: 'embed', label: 'Embed', hint: 'YouTube, Vimeo, X, any URL', glyph: '▷', terms: 'embed video youtube vimeo tweet' },
  { key: 'quote', label: 'Quote', hint: 'Pull the reader up short', glyph: '❝', terms: 'quote blockquote' },
  { key: 'bulletList', label: 'Bullet list', hint: 'A list of points', glyph: '•', terms: 'list bullet ul' },
  { key: 'codeBlock', label: 'Code block', hint: 'Syntax-highlighted', glyph: '{ }', terms: 'code pre snippet' },
  { key: 'divider', label: 'Divider', hint: 'A section break', glyph: '⋯', terms: 'divider rule hr break' },
];

/** Detect a `/query` typed at the start of an empty-ish paragraph. */
function readSlashQuery(editor) {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const { $from } = selection;
  const parent = $from.parent;
  // Paragraphs and headings only — never inside a code block, where "/" is code.
  if (!parent?.isTextblock) return null;
  if (parent.type.name !== 'paragraph' && parent.type.name !== 'heading') return null;
  const textBefore = parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const match = /^\/([\w-]*)$/.exec(textBefore);
  if (!match) return null;
  return { query: match[1], length: textBefore.length, pos: $from.pos };
}

export default function RichEditor({ value, onChange, autofocus = false, className = '' }) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const emittedRef = useRef(null);
  const containerRef = useRef(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [slash, setSlash] = useState(null);
  const [slashIndex, setSlashIndex] = useState(0);

  const extensions = useMemo(
    () =>
      buildExtensions({
        editable: true,
        onImageUploading: setUploading,
        onImageUploadError: (err) => setUploadError(err?.message || 'That upload failed.'),
      }),
    [],
  );

  const editor = useEditor({
    extensions,
    content: value || EMPTY_DOC,
    autofocus,
    editorProps: {
      attributes: {
        class: 'prose mi-surface',
        spellcheck: 'true',
        'aria-label': 'Story body',
      },
    },
    onUpdate({ editor: instance }) {
      const json = instance.getJSON();
      emittedRef.current = json;
      onChangeRef.current?.({
        json,
        html: instance.getHTML(),
        text: instance.getText(),
      });
    },
  });

  /* Adopt an externally-loaded document (e.g. /write/:id finished fetching)
     without clobbering what the writer is typing.

     The swap is deferred by a tick on purpose: setContent mounts the React node
     views for charts/timelines/embeds, and TipTap mounts those with flushSync.
     Doing that synchronously inside the effect (React's commit phase) makes
     React log "flushSync was called from inside a lifecycle method". A timeout
     puts it in a clean task instead — same frame to the eye, no warning. */
  useEffect(() => {
    if (!editor || !value) return undefined;
    const incoming = JSON.stringify(value);
    if (emittedRef.current && JSON.stringify(emittedRef.current) === incoming) return undefined;
    if (JSON.stringify(editor.getJSON()) === incoming) return undefined;
    const timer = setTimeout(() => {
      if (editor.isDestroyed) return;
      editor.commands.setContent(value, false);
      emittedRef.current = value;
    }, 0);
    return () => clearTimeout(timer);
  }, [editor, value]);

  /* Slash palette — track the caret. */
  useEffect(() => {
    if (!editor) return undefined;
    const sync = () => {
      const hit = readSlashQuery(editor);
      if (!hit) {
        setSlash(null);
        return;
      }
      let coords = { left: 0, top: 0 };
      try {
        const box = editor.view.coordsAtPos(hit.pos);
        const host = containerRef.current?.getBoundingClientRect();
        coords = {
          left: box.left - (host?.left ?? 0),
          top: box.bottom - (host?.top ?? 0) + 6,
        };
      } catch {
        /* the caret briefly has no coords mid-transaction — keep the last ones */
      }
      setSlash({ ...hit, ...coords });
      setSlashIndex(0);
    };
    const close = () => setSlash(null);
    editor.on('transaction', sync);
    editor.on('selectionUpdate', sync);
    editor.on('blur', close);
    return () => {
      editor.off('transaction', sync);
      editor.off('selectionUpdate', sync);
      editor.off('blur', close);
    };
  }, [editor]);

  const slashMatches = useMemo(() => {
    if (!slash) return [];
    const q = slash.query.toLowerCase();
    if (!q) return SLASH_ITEMS;
    return SLASH_ITEMS.filter(
      (item) => item.label.toLowerCase().includes(q) || item.terms.includes(q),
    );
  }, [slash]);

  const applySlash = useCallback(
    (item) => {
      if (!editor || !slash || !item) return;
      const { $from } = editor.state.selection;
      const from = Math.max($from.pos - slash.length, 0);
      editor.chain().focus().deleteRange({ from, to: $from.pos }).run();
      setSlash(null);
      runInsert(editor, item.key);
    },
    [editor, slash],
  );

  /* Keyboard driving for the palette — captured before ProseMirror sees it. */
  useEffect(() => {
    if (!editor || !slash || !slashMatches.length) return undefined;
    const dom = editor.view.dom;
    const onKeyDown = (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setSlashIndex((i) => (i + delta + slashMatches.length) % slashMatches.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        applySlash(slashMatches[slashIndex]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setSlash(null);
      }
    };
    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, slash, slashMatches, slashIndex, applySlash]);

  const words = editor?.storage?.characterCount?.words?.() ?? 0;
  const characters = editor?.storage?.characterCount?.characters?.() ?? 0;
  const readingTime = Math.max(1, Math.ceil(words / 200));

  return (
    <div className={`mi-editor ${className}`} ref={containerRef}>
      <Toolbar editor={editor} />
      <BubbleMenuBar editor={editor} />

      <div className="mi-editor-body">
        <EditorContent editor={editor} />

        {slash && slashMatches.length ? (
          <div
            className="mi-slash"
            style={{ left: `${slash.left}px`, top: `${slash.top}px` }}
            role="listbox"
            aria-label="Insert an element"
          >
            {slashMatches.map((item, index) => (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={index === slashIndex}
                className={`mi-slash-item ${index === slashIndex ? 'is-active' : ''}`}
                onMouseEnter={() => setSlashIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySlash(item)}
              >
                <span className="mi-insert-glyph" aria-hidden="true">
                  {item.glyph}
                </span>
                <span className="mi-insert-text">
                  <span className="mi-insert-label">{item.label}</span>
                  <span className="mi-insert-hint">{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mi-editor-foot">
        <span className="mi-foot-hint">
          Press <kbd>/</kbd> for images, tables, charts, timelines and embeds — or drop an image
          straight in.
        </span>
        <span className="mi-foot-spacer" />
        {uploading ? <span className="mi-foot-busy">Uploading image…</span> : null}
        {uploadError ? (
          <button
            type="button"
            className="mi-foot-error"
            onClick={() => setUploadError('')}
            title="Dismiss"
          >
            {uploadError} ✕
          </button>
        ) : null}
        <span className="mi-foot-count">
          {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
        </span>
        <span className="mi-foot-count">{characters.toLocaleString()} characters</span>
        <span className="mi-foot-count">{readingTime} min read</span>
      </div>
    </div>
  );
}
