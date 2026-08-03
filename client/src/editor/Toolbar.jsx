/**
 * Toolbar — the sticky formatting bar above the writing surface.
 *
 * Three rows, only the first of which is always present:
 *   1. marks, blocks, alignment, history and the INSERT menu
 *   2. the link editor (opens when you hit the link button)
 *   3. table controls (auto-reveals whenever the caret is inside a table)
 */
import { useEffect, useRef, useState } from 'react';

export const INSERT_ITEMS = [
  { key: 'image', label: 'Image', hint: 'Upload, drop or paste', glyph: '▣' },
  { key: 'table', label: 'Table', hint: '3 × 3 with a header row', glyph: '▦' },
  { key: 'chart', label: 'Chart', hint: 'Line, bar, area or pie', glyph: '◔' },
  { key: 'timeline', label: 'Timeline', hint: 'Interactive, expandable', glyph: '⋮' },
  { key: 'embed', label: 'Embed', hint: 'YouTube, Vimeo, X, any URL', glyph: '▷' },
];

/** Run one of the INSERT_ITEMS against an editor. Shared with the slash menu. */
export function runInsert(editor, key) {
  if (!editor) return;
  const chain = editor.chain().focus();
  switch (key) {
    case 'image':
      chain.insertImagePlaceholder().run();
      break;
    case 'table':
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      break;
    case 'chart':
      chain.insertChart().run();
      break;
    case 'timeline':
      chain.insertTimeline().run();
      break;
    case 'embed':
      chain.insertEmbed().run();
      break;
    case 'heading2':
      chain.toggleHeading({ level: 2 }).run();
      break;
    case 'heading3':
      chain.toggleHeading({ level: 3 }).run();
      break;
    case 'quote':
      chain.toggleBlockquote().run();
      break;
    case 'bulletList':
      chain.toggleBulletList().run();
      break;
    case 'codeBlock':
      chain.toggleCodeBlock().run();
      break;
    case 'divider':
      chain.setHorizontalRule().run();
      break;
    default:
      chain.run();
  }
}

function Btn({ active, disabled, label, onClick, children, wide }) {
  return (
    <button
      type="button"
      className={`mi-tb-btn ${active ? 'is-active' : ''} ${wide ? 'is-wide' : ''}`}
      onMouseDown={(event) => event.preventDefault()} /* keep the selection */
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active ? 'true' : undefined}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mi-tb-div" aria-hidden="true" />;
}

export default function Toolbar({ editor }) {
  const [insertOpen, setInsertOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const insertRef = useRef(null);
  const linkInputRef = useRef(null);

  useEffect(() => {
    if (!insertOpen) return undefined;
    const onDown = (event) => {
      if (!insertRef.current?.contains(event.target)) setInsertOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [insertOpen]);

  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus();
  }, [linkOpen]);

  if (!editor) return null;

  const inTable = editor.isActive('table');

  const openLink = () => {
    setLinkDraft(editor.getAttributes('link').href || '');
    setLinkOpen(true);
  };

  const applyLink = () => {
    const href = linkDraft.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      const safe = /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`;
      editor.chain().focus().extendMarkRange('link').setLink({ href: safe }).run();
    }
    setLinkOpen(false);
  };

  return (
    <div className="mi-toolbar" role="toolbar" aria-label="Formatting">
      <div className="mi-tb-row">
        <Btn
          label="Bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </Btn>
        <Btn
          label="Italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </Btn>
        <Btn
          label="Underline"
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <span style={{ textDecoration: 'underline' }}>U</span>
        </Btn>
        <Btn
          label="Strikethrough"
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <span style={{ textDecoration: 'line-through' }}>S</span>
        </Btn>
        <Btn
          label="Inline code"
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <code>{'<>'}</code>
        </Btn>

        <Divider />

        {[1, 2, 3].map((level) => (
          <Btn
            key={level}
            label={`Heading ${level}`}
            active={editor.isActive('heading', { level })}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          >
            H{level}
          </Btn>
        ))}
        <Btn
          label="Quote"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          ❝
        </Btn>
        <Btn
          label="Bullet list"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          •—
        </Btn>
        <Btn
          label="Numbered list"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1—
        </Btn>
        <Btn
          label="Code block"
          active={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          {'{ }'}
        </Btn>
        <Btn label="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          ⋯
        </Btn>
        <Btn label="Link" active={editor.isActive('link')} onClick={openLink}>
          ⛓
        </Btn>

        <Divider />

        {[
          ['left', '⇤'],
          ['center', '↔'],
          ['right', '⇥'],
        ].map(([align, glyph]) => (
          <Btn
            key={align}
            label={`Align ${align}`}
            active={editor.isActive({ textAlign: align })}
            onClick={() => editor.chain().focus().setTextAlign(align).run()}
          >
            {glyph}
          </Btn>
        ))}

        <Divider />

        <Btn
          label="Undo"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          ↶
        </Btn>
        <Btn
          label="Redo"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          ↷
        </Btn>

        <span className="mi-tb-spacer" />

        <div className="mi-insert" ref={insertRef}>
          <button
            type="button"
            className={`mi-tb-insert ${insertOpen ? 'is-open' : ''}`}
            onClick={() => setInsertOpen((v) => !v)}
            aria-expanded={insertOpen}
            aria-haspopup="menu"
          >
            <span aria-hidden="true">+</span> Insert
          </button>
          {insertOpen ? (
            <div className="mi-insert-menu" role="menu">
              {INSERT_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className="mi-insert-item"
                  onClick={() => {
                    setInsertOpen(false);
                    runInsert(editor, item.key);
                  }}
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
      </div>

      {linkOpen ? (
        <div className="mi-tb-row mi-tb-sub">
          <input
            ref={linkInputRef}
            className="mi-link-input"
            value={linkDraft}
            placeholder="https://example.com — empty to remove the link"
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') setLinkOpen(false);
            }}
          />
          <button type="button" className="mi-node-btn is-primary" onClick={applyLink}>
            Apply
          </button>
          <button type="button" className="mi-node-btn" onClick={() => setLinkOpen(false)}>
            Cancel
          </button>
        </div>
      ) : null}

      {inTable ? (
        <div className="mi-tb-row mi-tb-sub">
          <span className="mi-tb-tag">Table</span>
          <Btn wide label="Add column before" onClick={() => editor.chain().focus().addColumnBefore().run()}>
            +Col ←
          </Btn>
          <Btn wide label="Add column after" onClick={() => editor.chain().focus().addColumnAfter().run()}>
            +Col →
          </Btn>
          <Btn wide label="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}>
            −Col
          </Btn>
          <Divider />
          <Btn wide label="Add row before" onClick={() => editor.chain().focus().addRowBefore().run()}>
            +Row ↑
          </Btn>
          <Btn wide label="Add row after" onClick={() => editor.chain().focus().addRowAfter().run()}>
            +Row ↓
          </Btn>
          <Btn wide label="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}>
            −Row
          </Btn>
          <Divider />
          <Btn wide label="Toggle header row" onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
            Header
          </Btn>
          <Btn wide label="Merge or split cells" onClick={() => editor.chain().focus().mergeOrSplit().run()}>
            Merge
          </Btn>
          <Btn wide label="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}>
            Delete table
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
