/**
 * EmbedNode — paste a URL, get a responsive embed.
 *
 * Attrs: { url, provider, title }
 *   provider ∈ 'youtube' | 'vimeo' | 'twitter' | 'link'   (derived from the URL,
 *   stored so the reader never has to re-parse and so a future provider can be
 *   added without rewriting old documents).
 *
 * YouTube / Vimeo render as a 16:9 iframe; an X/Twitter post and anything else
 * render as a styled link card. No third-party script is loaded — the reader
 * page stays fast and works offline for everything but the iframe itself.
 */
import { useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';

/** Work out the provider and the embeddable URL for any pasted link. */
export function detectProvider(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return { provider: 'link', embedUrl: '', host: '' };

  let parsed;
  try {
    parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch {
    return { provider: 'link', embedUrl: '', host: '' };
  }

  const host = parsed.hostname.replace(/^www\./, '');
  const href = parsed.href;

  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0];
    return id
      ? { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${id}`, host, id }
      : { provider: 'link', embedUrl: '', host };
  }

  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    const id =
      parsed.searchParams.get('v') ||
      (/^\/(embed|shorts|live)\//.test(parsed.pathname) ? parsed.pathname.split('/')[2] : '');
    return id
      ? { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${id}`, host, id }
      : { provider: 'link', embedUrl: '', host };
  }

  if (host.endsWith('vimeo.com')) {
    const id = (parsed.pathname.match(/\/(\d{6,})/) || [])[1];
    return id
      ? { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}`, host, id }
      : { provider: 'link', embedUrl: '', host };
  }

  if (host === 'twitter.com' || host === 'x.com' || host.endsWith('.twitter.com')) {
    const handle = parsed.pathname.split('/').filter(Boolean)[0] || '';
    return { provider: 'twitter', embedUrl: href, host, handle };
  }

  return { provider: 'link', embedUrl: href, host };
}

const PROVIDER_LABEL = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  twitter: 'X · post',
  link: 'Link',
};

/* ------------------------------------------------------------- reading --- */

export function EmbedFigure({ url, provider, title }) {
  const info = detectProvider(url);
  const kind = provider && provider !== 'link' ? provider : info.provider;

  if (!url) return null;

  if ((kind === 'youtube' || kind === 'vimeo') && info.embedUrl) {
    return (
      <div className="mi-embed-frame">
        <iframe
          src={info.embedUrl}
          title={title || `${PROVIDER_LABEL[kind]} player`}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }

  const handle = kind === 'twitter' ? info.handle : '';

  return (
    <a
      className="mi-embed-card"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-provider={kind}
    >
      <span className="mi-embed-badge">{PROVIDER_LABEL[kind] || 'Link'}</span>
      <span className="mi-embed-card-title">
        {title || (handle ? `@${handle} on X` : info.host || url)}
      </span>
      <span className="mi-embed-card-url">{url}</span>
      <span className="mi-embed-card-go" aria-hidden="true">
        Open ↗
      </span>
    </a>
  );
}

/* ---------------------------------------------------------------- view --- */

function EmbedView({ node, updateAttributes, deleteNode, editor, selected }) {
  const { url, provider, title } = node.attrs;
  const editable = editor.isEditable;
  const [draft, setDraft] = useState(url || '');
  const [editing, setEditing] = useState(!url);

  // The URL can change underneath this view without the input knowing —
  // undo/redo rewrites node.attrs directly. Resync so "Change URL" does not
  // re-apply the value the writer just undid.
  const seenUrlRef = useRef(url || '');
  if (seenUrlRef.current !== (url || '')) {
    seenUrlRef.current = url || '';
    setDraft(url || '');
    setEditing(!url);
  }

  if (!editable) {
    return (
      <NodeViewWrapper as="figure" className="mi-embed" data-type="embed">
        <EmbedFigure url={url} provider={provider} title={title} />
        {title && (provider === 'youtube' || provider === 'vimeo') ? (
          <figcaption>{title}</figcaption>
        ) : null}
      </NodeViewWrapper>
    );
  }

  const apply = () => {
    const next = draft.trim();
    if (!next) return;
    updateAttributes({ url: next, provider: detectProvider(next).provider });
    setEditing(false);
  };

  return (
    <NodeViewWrapper
      as="figure"
      className={`mi-embed mi-node ${selected ? 'is-selected' : ''}`}
      data-type="embed"
    >
      <div className="mi-node-chrome" contentEditable={false}>
        <span className="mi-node-handle" data-drag-handle title="Drag to move">
          ⠿
        </span>
        <span className="mi-node-kind">Embed · {PROVIDER_LABEL[provider] || 'Link'}</span>
        <span className="mi-node-spacer" />
        {url ? (
          <button type="button" className="mi-node-btn" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : 'Change URL'}
          </button>
        ) : null}
        <button type="button" className="mi-node-btn is-danger" onClick={deleteNode}>
          Remove
        </button>
      </div>

      <div contentEditable={false} onKeyDown={(event) => event.stopPropagation()}>
        {editing ? (
          <div className="mi-embed-form">
            <input
              className="mi-mini-input"
              value={draft}
              autoFocus
              placeholder="Paste a YouTube, Vimeo or X link — or any URL"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  apply();
                }
              }}
            />
            <button type="button" className="mi-node-btn is-primary" onClick={apply}>
              Embed
            </button>
          </div>
        ) : null}

        {url ? <EmbedFigure url={url} provider={provider} title={title} /> : null}

        {url ? (
          <figcaption>
            <input
              className="mi-caption-input"
              value={title || ''}
              placeholder="Add a caption…"
              onChange={(event) => updateAttributes({ title: event.target.value })}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </figcaption>
        ) : null}
      </div>
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


export const EmbedNode = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-url') || '',
        renderHTML: (attributes) => (attributes.url ? { 'data-url': attributes.url } : {}),
      },
      provider: {
        default: 'link',
        parseHTML: (element) => element.getAttribute('data-provider') || 'link',
        renderHTML: (attributes) => ({ 'data-provider': attributes.provider || 'link' }),
      },
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title') || '',
        renderHTML: (attributes) => (attributes.title ? { 'data-title': attributes.title } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="embed"]' }, { tag: 'div[data-type="embed"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const { url, title } = node.attrs;
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-type': 'embed', class: 'mi-embed' }),
      ['a', { href: url || '#', target: '_blank', rel: 'noopener noreferrer' }, title || url || ''],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },

  addCommands() {
    return {
      insertEmbed:
        (attrs = {}) =>
        ({ state, commands }) => {
          const url = attrs.url || '';
          const content = [
            {
              type: this.name,
              attrs: {
                url,
                provider: url ? detectProvider(url).provider : 'link',
                title: '',
                ...attrs,
              },
            },
            { type: 'paragraph' },
          ];
          const at = blockInsertPos(state);
          return at === undefined
            ? commands.insertContent(content)
            : commands.insertContentAt(at, content);
        },
    };
  },
});

export default EmbedNode;
