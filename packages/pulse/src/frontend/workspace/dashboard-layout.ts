import type {
  PulseDashboardConfig,
  PulseDashboardEventsWidget,
  PulseDashboardMetricWidget,
  PulseDashboardSection,
  PulseDashboardStatesWidget,
  PulseDashboardWidget,
} from "../../contracts";

const dashboardAutoSpan = (cellCount: number): number => {
  if (cellCount <= 1) return 12;
  if (cellCount === 2) return 6;
  if (cellCount === 3) return 4;
  return 3;
};

export const dashboardCellSpan = (span: number | null | undefined, cellCount: number): number =>
  Math.min(12, Math.max(1, span ?? dashboardAutoSpan(cellCount)));

const dashboardWidgetDescendants = (widget: PulseDashboardWidget): PulseDashboardWidget[] =>
  widget.kind === "card" ? [widget, ...widget.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants))] : [widget];

const dashboardSectionWidgets = (section: PulseDashboardSection): PulseDashboardWidget[] => [
  ...section.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants)),
  ...(section.sections ?? []).flatMap(dashboardSectionWidgets),
];

export const dashboardLayoutWidgets = (config: PulseDashboardConfig): PulseDashboardWidget[] =>
  config.layout?.sections.flatMap(dashboardSectionWidgets) ?? [];

export const dashboardMetricWidgets = (config: PulseDashboardConfig): PulseDashboardMetricWidget[] =>
  dashboardLayoutWidgets(config).filter((widget): widget is PulseDashboardMetricWidget => widget.kind === "metric");

export const dashboardEventsWidgets = (config: PulseDashboardConfig): PulseDashboardEventsWidget[] =>
  dashboardLayoutWidgets(config).filter((widget): widget is PulseDashboardEventsWidget => widget.kind === "events");

export const dashboardStatesWidgets = (config: PulseDashboardConfig): PulseDashboardStatesWidget[] =>
  dashboardLayoutWidgets(config).filter((widget): widget is PulseDashboardStatesWidget => widget.kind === "states");
