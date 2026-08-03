/**
 * TimelineNode — an interactive timeline.
 *
 * Attrs: { events: [{ date, title, description, icon }] }
 *
 * Reading : a vertical timeline whose entries EXPAND on click (and preview on
 *           hover). Keyboard-operable — every entry is a real <button> with
 *           aria-expanded, and arrow keys walk the rail.
 * Editing : add / remove / reorder entries with live inputs.
 */
import { useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';

export const TIMELINE_ICONS = ['●', '◆', '▲', '★', '⚑', '✦'];

export const DEFAULT_TIMELINE_EVENTS = [
  {
    date: '2019',
    title: 'The first draft',
    description: 'Where the idea started, and what it looked like before anyone else saw it.',
    icon: '●',
  },
  {
    date: '2022',
    title: 'The turn',
    description: 'The moment the project changed direction — and why that mattered.',
    icon: '◆',
  },
  {
    date: 'Today',
    title: 'Where it stands',
    description: 'What shipped, what is still open, and what comes next.',
    icon: '★',
  },
];

function normalizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.filter(Boolean).map((event) => ({
    date: String(event.date ?? ''),
    title: String(event.title ?? ''),
    description: String(event.description ?? ''),
    icon: String(event.icon ?? '●'),
  }));
}

function readJsonAttr(element, name, fallback) {
  const raw = element.getAttribute(name);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------- reading --- */

export function TimelineFigure({ events }) {
  const rows = normalizeEvents(events);
  const [openIndex, setOpenIndex] = useState(0);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const railRef = useRef(null);

  if (!rows.length) return <div className="mi-chart-empty">No events on this timeline yet.</div>;

  const onKeyDown = (event, index) => {
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + rows.length) % rows.length;
    setOpenIndex(next);
    railRef.current?.querySelectorAll('.mi-tl-trigger')[next]?.focus();
  };

  return (
    <ol className="mi-timeline-rail" ref={railRef}>
      {rows.map((event, index) => {
        const open = openIndex === index;
        return (
          // eslint-disable-next-line react/no-array-index-key
          <li
            key={index}
            className={`mi-tl-item ${open ? 'is-open' : ''} ${hoverIndex === index ? 'is-hover' : ''}`}
            onMouseEnter={() => setHoverIndex(index)}
            onMouseLeave={() => setHoverIndex(-1)}
          >
            <span className="mi-tl-dot" aria-hidden="true">
              {event.icon || '●'}
            </span>
            <button
              type="button"
              className="mi-tl-trigger"
              aria-expanded={open}
              onKeyDown={(keyEvent) => onKeyDown(keyEvent, index)}
              onClick={() => setOpenIndex(open ? -1 : index)}
            >
              <span className="mi-tl-date">{event.date}</span>
              <span className="mi-tl-title">{event.title}</span>
              <span className="mi-tl-chevron" aria-hidden="true">
                {open ? '−' : '+'}
              </span>
            </button>
            <div className="mi-tl-body" hidden={!open}>
              <p>{event.description}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------- view --- */

function TimelineView({ node, updateAttributes, deleteNode, editor, selected }) {
  const editable = editor.isEditable;
  const events = Array.isArray(node.attrs.events) ? node.attrs.events : [];
  const setEvents = (next) => updateAttributes({ events: next });

  if (!editable) {
    return (
      <NodeViewWrapper as="figure" className="mi-timeline" data-type="timeline">
        <TimelineFigure events={events} />
      </NodeViewWrapper>
    );
  }

  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= events.length) return;
    const next = events.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setEvents(next);
  };

  const patch = (index, partial) => {
    const next = events.slice();
    next[index] = { ...next[index], ...partial };
    setEvents(next);
  };

  return (
    <NodeViewWrapper
      as="figure"
      className={`mi-timeline mi-node ${selected ? 'is-selected' : ''}`}
      data-type="timeline"
    >
      <div className="mi-node-chrome" contentEditable={false}>
        <span className="mi-node-handle" data-drag-handle title="Drag to move">
          ⠿
        </span>
        <span className="mi-node-kind">Timeline</span>
        <span className="mi-node-spacer" />
        <button
          type="button"
          className="mi-node-btn"
          onClick={() =>
            setEvents([...events, { date: '', title: 'New moment', description: '', icon: '●' }])
          }
        >
          + Add event
        </button>
        <button type="button" className="mi-node-btn is-danger" onClick={deleteNode}>
          Remove
        </button>
      </div>

      <div
        className="mi-tl-editor"
        contentEditable={false}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {events.length === 0 ? (
          <p className="mi-chart-empty">Add the first moment of this timeline.</p>
        ) : null}

        {events.map((event, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <div className="mi-tl-edit-row" key={index}>
            <div className="mi-tl-edit-side">
              <select
                className="mi-mini-input mi-icon-select"
                value={event.icon || '●'}
                onChange={(changeEvent) => patch(index, { icon: changeEvent.target.value })}
                aria-label={`Marker for event ${index + 1}`}
              >
                {TIMELINE_ICONS.map((icon) => (
                  <option key={icon} value={icon}>
                    {icon}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="mi-icon-mini"
                title="Move up"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="mi-icon-mini"
                title="Move down"
                disabled={index === events.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="mi-icon-mini"
                title="Remove event"
                onClick={() => setEvents(events.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
            <div className="mi-tl-edit-fields">
              <div className="mi-tl-edit-top">
                <input
                  className="mi-mini-input mi-tl-date-input"
                  value={event.date || ''}
                  placeholder="When (e.g. March 2024)"
                  onChange={(changeEvent) => patch(index, { date: changeEvent.target.value })}
                />
                <input
                  className="mi-mini-input"
                  value={event.title || ''}
                  placeholder="What happened"
                  onChange={(changeEvent) => patch(index, { title: changeEvent.target.value })}
                />
              </div>
              <textarea
                className="mi-mini-input mi-tl-desc-input"
                rows={2}
                value={event.description || ''}
                placeholder="The detail readers see when they expand this entry…"
                onChange={(changeEvent) => patch(index, { description: changeEvent.target.value })}
              />
            </div>
          </div>
        ))}
      </div>

      <details className="mi-node-preview">
        <summary>Preview how readers will see it</summary>
        <TimelineFigure events={events} />
      </details>
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


export const TimelineNode = Node.create({
  name: 'timeline',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      events: {
        default: DEFAULT_TIMELINE_EVENTS,
        parseHTML: (element) => readJsonAttr(element, 'data-events', []),
        renderHTML: (attributes) => ({
          'data-events': JSON.stringify(
            Array.isArray(attributes.events) ? attributes.events : [],
          ),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="timeline"]' }, { tag: 'div[data-type="timeline"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    // The static HTML mirror stays readable on its own (it is what the excerpt
    // and any non-JS fallback see); the interactive version comes from the JSON.
    const items = normalizeEvents(node.attrs.events).map((event) => [
      'li',
      {},
      ['strong', {}, event.date ? `${event.date} — ` : ''],
      ['span', {}, event.title || ''],
      event.description ? ['p', {}, event.description] : ['span', {}, ''],
    ]);
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-type': 'timeline', class: 'mi-timeline' }),
      ['ol', { class: 'mi-timeline-static' }, ...items],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TimelineView);
  },

  addCommands() {
    return {
      insertTimeline:
        (attrs = {}) =>
        ({ state, commands }) => {
          const content = [
            {
              type: this.name,
              attrs: {
                events: DEFAULT_TIMELINE_EVENTS.map((event) => ({ ...event })),
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

export default TimelineNode;
