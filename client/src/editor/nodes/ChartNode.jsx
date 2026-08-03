/**
 * ChartNode — an interactive chart embedded in the story.
 *
 * Attrs: { chartType: 'line'|'bar'|'area'|'pie', title, series, data: [{label, value}] }
 * Everything lives in the node's attributes, so the chart round-trips through
 * `content_json` untouched — save, reload, and it is the same chart.
 *
 * Editing  : a compact data editor (add / remove / edit rows, switch type) with
 *            a live preview of the exact chart the reader will get.
 * Reading  : the responsive recharts figure, with working hover tooltips and
 *            legend — genuinely interactive, not a picture of a chart.
 */
import { useMemo, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export const CHART_TYPES = [
  { value: 'line', label: 'Line' },
  { value: 'bar', label: 'Bar' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' },
];

/* Tuned against the design system's lake-teal accent (styles/global.css). */
const PALETTE = ['#0e6b70', '#4c9f93', '#86c2ae', '#c2a35a', '#a05a3d', '#5d7078'];
const INK = '#10222b';
const MUTED = '#5d7078';
const GRID = '#dde5e3';

export const DEFAULT_CHART_DATA = [
  { label: 'Jan', value: 32 },
  { label: 'Feb', value: 48 },
  { label: 'Mar', value: 41 },
  { label: 'Apr', value: 67 },
];

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

/** Coerce whatever is in the attribute into [{label, value}] recharts can draw. */
function normalizeRows(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter(Boolean)
    .map((row, index) => ({
      label: String(row.label ?? `Item ${index + 1}`),
      value: Number.isFinite(Number(row.value)) ? Number(row.value) : 0,
    }));
}

const tooltipStyle = {
  contentStyle: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: 13,
    borderRadius: 10,
    border: '1px solid #dde5e3',
    boxShadow: '0 12px 32px rgba(16, 34, 43, 0.1)',
  },
  cursor: { fill: 'rgba(14, 107, 112, 0.06)', stroke: 'rgba(14, 107, 112, 0.25)' },
};

const axis = {
  stroke: MUTED,
  tick: { fill: MUTED, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: GRID },
};

/** The chart itself — identical in the editor preview and in the reader. */
export function ChartFigure({ chartType, data, series }) {
  const rows = useMemo(() => normalizeRows(data), [data]);
  const name = series || 'Value';

  if (!rows.length) {
    return <div className="mi-chart-empty">No data yet — add a row to draw this chart.</div>;
  }

  const common = { data: rows, margin: { top: 8, right: 12, bottom: 4, left: -12 } };

  let chart = null;
  if (chartType === 'bar') {
    chart = (
      <BarChart {...common}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} />
        <Tooltip {...tooltipStyle} />
        <Bar dataKey="value" name={name} fill={PALETTE[0]} radius={[6, 6, 0, 0]} />
      </BarChart>
    );
  } else if (chartType === 'area') {
    chart = (
      <AreaChart {...common}>
        <defs>
          <linearGradient id="mi-area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PALETTE[0]} stopOpacity={0.35} />
            <stop offset="100%" stopColor={PALETTE[0]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} />
        <Tooltip {...tooltipStyle} />
        <Area
          type="monotone"
          dataKey="value"
          name={name}
          stroke={PALETTE[0]}
          strokeWidth={2}
          fill="url(#mi-area-fill)"
        />
      </AreaChart>
    );
  } else if (chartType === 'pie') {
    chart = (
      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <Tooltip {...tooltipStyle} cursor={false} />
        <Legend
          verticalAlign="bottom"
          iconType="circle"
          wrapperStyle={{ fontSize: 13, color: MUTED }}
        />
        <Pie
          data={rows}
          dataKey="value"
          nameKey="label"
          innerRadius="45%"
          outerRadius="78%"
          paddingAngle={2}
          stroke="#ffffff"
          strokeWidth={2}
        >
          {rows.map((row, index) => (
            <Cell key={row.label + index} fill={PALETTE[index % PALETTE.length]} />
          ))}
        </Pie>
      </PieChart>
    );
  } else {
    chart = (
      <LineChart {...common}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} />
        <Tooltip {...tooltipStyle} />
        <Line
          type="monotone"
          dataKey="value"
          name={name}
          stroke={PALETTE[0]}
          strokeWidth={2.5}
          dot={{ r: 3, fill: PALETTE[0], strokeWidth: 0 }}
          activeDot={{ r: 6, fill: INK }}
        />
      </LineChart>
    );
  }

  return (
    <div className="mi-chart-canvas">
      <ResponsiveContainer width="100%" height="100%">
        {chart}
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------------- view --- */

function ChartView({ node, updateAttributes, deleteNode, editor, selected }) {
  const { chartType, title, series, data } = node.attrs;
  const editable = editor.isEditable;
  const [open, setOpen] = useState(false);

  const rows = Array.isArray(data) ? data : [];
  const setRows = (next) => updateAttributes({ data: next });

  if (!editable) {
    return (
      <NodeViewWrapper as="figure" className="mi-chart" data-type="chart">
        {title ? <figcaption className="mi-chart-title">{title}</figcaption> : null}
        <ChartFigure chartType={chartType} data={rows} series={series} />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="figure"
      className={`mi-chart mi-node ${selected ? 'is-selected' : ''}`}
      data-type="chart"
    >
      <div className="mi-node-chrome" contentEditable={false}>
        <span className="mi-node-handle" data-drag-handle title="Drag to move">
          ⠿
        </span>
        <span className="mi-node-kind">Chart</span>
        <div className="mi-seg" role="group" aria-label="Chart type">
          {CHART_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              className={`mi-seg-btn ${chartType === type.value ? 'is-active' : ''}`}
              onClick={() => updateAttributes({ chartType: type.value })}
            >
              {type.label}
            </button>
          ))}
        </div>
        <span className="mi-node-spacer" />
        <button type="button" className="mi-node-btn" onClick={() => setOpen((v) => !v)}>
          {open ? 'Done' : 'Edit data'}
        </button>
        <button type="button" className="mi-node-btn is-danger" onClick={deleteNode}>
          Remove
        </button>
      </div>

      <div contentEditable={false} onKeyDown={(event) => event.stopPropagation()}>
        <input
          className="mi-chart-title-input"
          value={title || ''}
          placeholder="Chart title"
          onChange={(event) => updateAttributes({ title: event.target.value })}
        />

        <ChartFigure chartType={chartType} data={rows} series={series} />

        {open ? (
          <div className="mi-data-editor">
            <div className="mi-data-head">
              <span>Label</span>
              <span>Value</span>
              <span />
            </div>
            {rows.map((row, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <div className="mi-data-row" key={index}>
                <input
                  className="mi-mini-input"
                  value={row.label ?? ''}
                  placeholder="Label"
                  onChange={(event) => {
                    const next = rows.slice();
                    next[index] = { ...next[index], label: event.target.value };
                    setRows(next);
                  }}
                />
                <input
                  className="mi-mini-input"
                  type="number"
                  value={row.value ?? 0}
                  onChange={(event) => {
                    const next = rows.slice();
                    next[index] = { ...next[index], value: Number(event.target.value) };
                    setRows(next);
                  }}
                />
                <button
                  type="button"
                  className="mi-icon-mini"
                  title="Remove row"
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="mi-data-actions">
              <button
                type="button"
                className="mi-node-btn"
                onClick={() => setRows([...rows, { label: `Item ${rows.length + 1}`, value: 0 }])}
              >
                + Add row
              </button>
              <input
                className="mi-mini-input mi-series-input"
                value={series || ''}
                placeholder="Series name (e.g. Revenue)"
                onChange={(event) => updateAttributes({ series: event.target.value })}
              />
            </div>
          </div>
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


export const ChartNode = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      chartType: {
        default: 'bar',
        parseHTML: (element) => element.getAttribute('data-chart-type') || 'bar',
        renderHTML: (attributes) => ({ 'data-chart-type': attributes.chartType || 'bar' }),
      },
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title') || '',
        renderHTML: (attributes) => (attributes.title ? { 'data-title': attributes.title } : {}),
      },
      series: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-series') || '',
        renderHTML: (attributes) => (attributes.series ? { 'data-series': attributes.series } : {}),
      },
      data: {
        default: DEFAULT_CHART_DATA,
        parseHTML: (element) => readJsonAttr(element, 'data-rows', []),
        renderHTML: (attributes) => ({
          'data-rows': JSON.stringify(Array.isArray(attributes.data) ? attributes.data : []),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="chart"]' }, { tag: 'div[data-type="chart"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const caption = node.attrs.title ? [['figcaption', {}, node.attrs.title]] : [];
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-type': 'chart', class: 'mi-chart' }),
      ...caption,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChartView);
  },

  addCommands() {
    return {
      insertChart:
        (attrs = {}) =>
        ({ state, commands }) => {
          const content = [
            {
              type: this.name,
              attrs: {
                chartType: 'bar',
                title: '',
                series: '',
                data: DEFAULT_CHART_DATA.map((row) => ({ ...row })),
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

export default ChartNode;
