/**
 * THE SINGLE SHARED EXTENSION REGISTRY.
 *
 *   import { buildExtensions } from './extensions.js';
 *
 * `buildExtensions({editable})` returns the complete extension array, and it is
 * the ONLY place extensions are configured. Both sides use it:
 *
 *   • RichEditor.jsx   — buildExtensions({editable: true})
 *   • RichContent.jsx  — buildExtensions({editable: false})
 *
 * That is deliberate and load-bearing: the reader's document is parsed by the
 * exact same schema that wrote it, so what you compose is literally what a
 * reader sees, and charts / timelines / embeds stay interactive after publish.
 * Do NOT configure an extension anywhere else — add it here.
 *
 * The `editable` flag only ever changes *behaviour* (link click-through, table
 * column resizing, upload handlers), never the schema. Keeping the schema
 * identical in both directions is what makes round-tripping through
 * `content_json` safe.
 */
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { createLowlight } from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

import { ImageNode } from './nodes/ImageNode.jsx';
import { ChartNode } from './nodes/ChartNode.jsx';
import { TimelineNode } from './nodes/TimelineNode.jsx';
import { EmbedNode } from './nodes/EmbedNode.jsx';

import '../styles/editor.css';

/* A curated language set rather than lowlight's `common` — the full bundle is
   ~35 grammars and this is a blogging platform, not an IDE. Add a language here
   if a writer needs one. */
const lowlight = createLowlight({
  bash,
  css,
  go,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
});

export const PLACEHOLDER_TEXT = 'Tell your story…';

/** An empty TipTap document — the starting point for a new story. */
export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * @param {object}   [options]
 * @param {boolean}  [options.editable=true]      composing (true) or reading (false)
 * @param {Function} [options.onImageUploading]   called with true/false around a paste/drop upload
 * @param {Function} [options.onImageUploadError] called with the Error if one fails
 * @returns {Array} the full extension list
 */
export function buildExtensions({
  editable = true,
  onImageUploading = null,
  onImageUploadError = null,
} = {}) {
  return [
    StarterKit.configure({
      // Replaced by CodeBlockLowlight below — two code-block nodes cannot coexist.
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
      horizontalRule: { HTMLAttributes: { class: 'mi-rule' } },
      blockquote: { HTMLAttributes: { class: 'mi-quote' } },
      dropcursor: { color: '#0e6b70', width: 2 },
    }),

    Underline,

    Link.configure({
      // In the editor a click should place the caret, not navigate away.
      openOnClick: !editable,
      autolink: true,
      linkOnPaste: true,
      protocols: ['http', 'https', 'mailto'],
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),

    TextAlign.configure({ types: ['heading', 'paragraph'] }),

    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),

    Table.configure({
      resizable: editable,
      lastColumnResizable: false,
      allowTableNodeSelection: true,
      HTMLAttributes: { class: 'mi-table' },
    }),
    TableRow,
    TableHeader,
    TableCell,

    // showOnlyWhenEditable defaults to true, so readers never see this.
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ node, pos }) => {
        if (node.type.name === 'heading') return 'Section heading';
        if (node.type.name === 'paragraph') {
          return pos === 0 ? PLACEHOLDER_TEXT : 'Keep writing, or press / for an element…';
        }
        return '';
      },
    }),

    CharacterCount.configure({ limit: null }),

    ImageNode.configure({
      onUploading: onImageUploading,
      onUploadError: onImageUploadError,
    }),
    ChartNode,
    TimelineNode,
    EmbedNode,
  ];
}

export default buildExtensions;
