/**
 * RichContent — every article body in michigan renders through this component.
 *
 *   <RichContent html={article.contentHtml} json={article.contentJson} />
 *
 * It mounts a non-editable TipTap editor built from the SAME registry the
 * writing surface uses (`buildExtensions({editable: false})`), so a reader gets
 * exactly what the author composed — and charts, timelines and embeds stay
 * INTERACTIVE rather than being flattened into static markup.
 *
 * `json` is authoritative. If it is missing, a string that will not parse, or
 * fails the schema check (an old document written by a different extension
 * set), the component silently falls back to the stored `contentHtml` inside
 * the same `.prose` wrapper — a reader never sees an empty article.
 *
 * PROP SIGNATURE IS FROZEN: {html, json}. The article reader and the profile
 * pages import this; do not rename or add required props.
 */
import { useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { buildExtensions } from './extensions.js';
import '../styles/editor.css';

/** Accepts a doc object or a JSON string; returns a usable doc or null. */
export function parseDoc(json) {
  if (!json) return null;
  let doc = json;
  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc);
    } catch {
      return null;
    }
  }
  if (!doc || typeof doc !== 'object') return null;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return null;
  return doc;
}

export default function RichContent({ html, json }) {
  const doc = useMemo(() => parseDoc(json), [json]);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [doc]);

  const extensions = useMemo(() => buildExtensions({ editable: false }), []);

  const editor = useEditor(
    {
      extensions,
      content: doc || undefined,
      editable: false,
      // A node the current schema does not know about must not blow up the
      // reader — it drops us onto the HTML fallback instead.
      enableContentCheck: true,
      onContentError: () => setBroken(true),
      editorProps: { attributes: { class: 'prose mi-read' } },
    },
    [doc],
  );

  if (!doc || broken || !editor) {
    return <div className="prose" dangerouslySetInnerHTML={{ __html: html || '' }} />;
  }

  return <EditorContent editor={editor} className="mi-rich-content" />;
}
