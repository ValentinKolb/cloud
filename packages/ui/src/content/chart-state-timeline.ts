import { charts } from "@k2b/stdlib";

export type StateTimelineDomain = readonly [number, number];
export type StateTimelineInterval = {
  from: number;
  to: number;
  state: string;
  label?: string;
  href?: string;
  tooltip?: string;
};
export type StateTimelineRow = {
  label: string;
  href?: string;
  tooltip?: string;
  intervals: StateTimelineInterval[];
};
export type StateTimelineState = { state: string; label?: string; color?: string };
export type StateTimelineOptions = {
  rows: StateTimelineRow[];
  states?: StateTimelineState[];
  domain?: StateTimelineDomain;
  xAxis?: { format?: (value: number) => string; label?: string };
  legend?: boolean;
};

const MIN_VIEW_FRACTION = 1 / 64;
const finiteDomain = (domain: StateTimelineDomain | undefined): StateTimelineDomain | null => {
  if (!domain || !Number.isFinite(domain[0]) || !Number.isFinite(domain[1]) || domain[0] === domain[1]) return null;
  return domain[0] < domain[1] ? domain : [domain[1], domain[0]];
};

export const stateTimelineDomain = (rows: readonly StateTimelineRow[], explicit?: StateTimelineDomain): StateTimelineDomain => {
  const provided = finiteDomain(explicit);
  if (provided) return provided;
  const values = rows.flatMap((row) => row.intervals.flatMap((interval) => [interval.from, interval.to])).filter(Number.isFinite);
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? [min, min + 1] : [min, max];
};

export const normalizeStateTimelineViewport = (
  viewport: StateTimelineDomain | undefined,
  fullDomain: StateTimelineDomain,
): StateTimelineDomain => {
  const full = finiteDomain(fullDomain) ?? [0, 1];
  const current = finiteDomain(viewport);
  if (!current) return full;
  const span = Math.min(current[1] - current[0], full[1] - full[0]);
  const start = Math.max(full[0], Math.min(current[0], full[1] - span));
  return [start, start + span];
};

export const zoomStateTimelineViewport = (
  viewport: StateTimelineDomain,
  fullDomain: StateTimelineDomain,
  direction: number,
  anchor = 0.5,
): StateTimelineDomain => {
  const current = normalizeStateTimelineViewport(viewport, fullDomain);
  const fullSpan = fullDomain[1] - fullDomain[0];
  const span = Math.max(fullSpan * MIN_VIEW_FRACTION, Math.min(fullSpan, (current[1] - current[0]) * (direction > 0 ? 0.7 : 1 / 0.7)));
  const ratio = Math.max(0, Math.min(1, anchor));
  const point = current[0] + (current[1] - current[0]) * ratio;
  return normalizeStateTimelineViewport([point - span * ratio, point + span * (1 - ratio)], fullDomain);
};

export const panStateTimelineViewport = (
  viewport: StateTimelineDomain,
  fullDomain: StateTimelineDomain,
  pixelDelta: number,
  width: number,
): StateTimelineDomain => {
  if (width <= 0) return normalizeStateTimelineViewport(viewport, fullDomain);
  const current = normalizeStateTimelineViewport(viewport, fullDomain);
  const delta = (-pixelDelta / width) * (current[1] - current[0]);
  return normalizeStateTimelineViewport([current[0] + delta, current[1] + delta], fullDomain);
};

export const stateTimelineHeight = (rows: number, legend = true): number => Math.max(160, 66 + rows * 24 + (legend ? 24 : 0));

const safeHref = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value, "https://ui.invalid");
    return ["http:", "https:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
};
const escapeAttribute = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const renderStateTimeline = (
  options: StateTimelineOptions & { width: number; height: number; viewport?: StateTimelineDomain },
): string => {
  const full = stateTimelineDomain(options.rows, options.domain);
  const viewport = normalizeStateTimelineViewport(options.viewport, full);
  const clippedRows = options.rows.map((row) => ({
    label: row.label,
    intervals: row.intervals
      .filter((interval) => Number.isFinite(interval.from) && Number.isFinite(interval.to))
      .filter((interval) => Math.max(interval.from, interval.to) >= viewport[0] && Math.min(interval.from, interval.to) <= viewport[1])
      .map((interval) => ({
        ...interval,
        from: Math.max(viewport[0], Math.min(interval.from, interval.to)),
        to: Math.min(viewport[1], Math.max(interval.from, interval.to)),
      })),
  }));
  const rowsWithDomain = clippedRows.map((row, index) => ({
    ...row,
    intervals:
      index === 0
        ? [...row.intervals, { from: viewport[0], to: viewport[1], state: "__k2b_viewport__" }]
        : row.intervals,
  }));
  let svg = charts.stateTimeline({
    rows: rowsWithDomain,
    states: options.states,
    xAxis: options.xAxis,
    legend: options.legend,
    width: options.width,
    height: options.height,
  });
  let rowIndex = 0;
  svg = svg.replace(/<text class="stdlib-chart-state-label"([^>]*)>(.*?)<\/text>/g, (match) => {
    const row = options.rows[rowIndex++];
    if (!row) return match;
    const href = safeHref(row.href);
    const tooltip = escapeAttribute(row.tooltip ?? row.label);
    const body = `<g data-chart-tooltip="${tooltip}" tabindex="0" role="img" aria-label="${tooltip}">${match}<title>${tooltip}</title></g>`;
    return href ? `<a href="${escapeAttribute(href)}">${body}</a>` : body;
  });
  let intervalIndex = 0;
  const intervals = options.rows.flatMap((row, rowIndex) => {
    const visible = row.intervals
      .filter((interval) => Math.max(interval.from, interval.to) >= viewport[0] && Math.min(interval.from, interval.to) <= viewport[1])
      .map((interval) => ({ row, interval, sentinel: false }));
    return rowIndex === 0
      ? [...visible, { row, interval: { from: viewport[0], to: viewport[1], state: "__k2b_viewport__" }, sentinel: true }]
      : visible;
  });
  svg = svg.replace(/<rect class="stdlib-chart-state-region[^"]*"([^>]*)\/>/g, (match) => {
    const entry = intervals[intervalIndex++];
    if (!entry) return match;
    if (entry.sentinel) return "";
    const label = entry.interval.tooltip ?? entry.interval.label ?? `${entry.row.label}, ${entry.interval.state}`;
    const escaped = escapeAttribute(label);
    const href = safeHref(entry.interval.href);
    const body = `<g data-chart-tooltip="${escaped}" tabindex="0" role="img" aria-label="${escaped}">${match}<title>${escaped}</title></g>`;
    return href ? `<a href="${escapeAttribute(href)}">${body}</a>` : body;
  });
  return svg;
};
