/**
 * BubbleMenuBar — the Medium-style selection bubble.
 *
 * Select text and the essentials float in: bold, italic, link, H2, quote. It
 * deliberately stays small; the full set lives in the sticky Toolbar. Clicking
 * the link button swaps the bubble into a one-field link editor.
 */
import { useEffect, useRef, useState } from 'react';
import { BubbleMenu } from '@tiptap/react';

export default function BubbleMenuBar({ editor }) {
  const [linkMode, setLinkMode] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (linkMode) inputRef.current?.focus();
  }, [linkMode]);

  if (!editor) return null;

  const openLink = () => {
    setDraft(editor.getAttributes('link').href || '');
    setLinkMode(true);
  };

  const applyLink = () => {
    const href = draft.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      const safe = /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`;
      editor.chain().focus().extendMarkRange('link').setLink({ href: safe }).run();
    }
    setLinkMode(false);
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="michiganBubble"
      tippyOptions={{ duration: 120, maxWidth: 460 }}
      shouldShow={({ editor: instance, state, from, to }) => {
        if (!instance.isEditable) return false;
        if (from === to) return false;
        // Never over an atom (image / chart / timeline / embed) or a code block —
        // those carry their own controls.
        if (
          instance.isActive('image') ||
          instance.isActive('chart') ||
          instance.isActive('timeline') ||
          instance.isActive('embed') ||
          instance.isActive('codeBlock')
        ) {
          return false;
        }
        return state.doc.textBetween(from, to, ' ').trim().length > 0;
      }}
      onHidden={() => setLinkMode(false)}
    >
      {linkMode ? (
        <div className="mi-bubble">
          <input
            ref={inputRef}
            className="mi-bubble-input"
            value={draft}
            placeholder="Paste a link and press ↵"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') setLinkMode(false);
            }}
          />
          <button type="button" className="mi-bubble-btn" onClick={applyLink}>
            Apply
          </button>
        </div>
      ) : (
        <div className="mi-bubble">
          <button
            type="button"
            className={`mi-bubble-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold"
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={`mi-bubble-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className={`mi-bubble-btn ${editor.isActive('link') ? 'is-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openLink}
            title="Link"
          >
            ⛓
          </button>
          <span className="mi-bubble-div" aria-hidden="true" />
          <button
            type="button"
            className={`mi-bubble-btn ${editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="Heading"
          >
            H2
          </button>
          <button
            type="button"
            className={`mi-bubble-btn ${editor.isActive('blockquote') ? 'is-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Quote"
          >
            ❝
          </button>
        </div>
      )}
    </BubbleMenu>
  );
}
