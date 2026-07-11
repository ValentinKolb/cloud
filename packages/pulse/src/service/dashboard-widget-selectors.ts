import type {
  PulseDashboardConfig,
  PulseDashboardEventsWidget,
  PulseDashboardMetricWidget,
  PulseDashboardSection,
  PulseDashboardStatesWidget,
  PulseDashboardWidget,
} from "../contracts";

const dashboardWidgetDescendants = (widget: PulseDashboardWidget): PulseDashboardWidget[] => {
  if (widget.kind !== "card") return [widget];
  return [widget, ...widget.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants))];
};

const dashboardSectionWidgets = (section: PulseDashboardSection): PulseDashboardWidget[] => [
  ...section.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants)),
  ...(section.sections ?? []).flatMap(dashboardSectionWidgets),
];

const dashboardLayoutWidgets = (config: PulseDashboardConfig): PulseDashboardWidget[] =>
  config.layout?.sections.flatMap(dashboardSectionWidgets) ?? [];

export const dashboardMetricWidgets = (config: PulseDashboardConfig): PulseDashboardMetricWidget[] => [
  ...dashboardLayoutWidgets(config).filter((widget): widget is PulseDashboardMetricWidget => widget.kind === "metric"),
];

export const dashboardEventsWidgets = (config: PulseDashboardConfig): PulseDashboardEventsWidget[] =>
  dashboardLayoutWidgets(config).filter((widget): widget is PulseDashboardEventsWidget => widget.kind === "events");

export const dashboardStatesWidgets = (config: PulseDashboardConfig): PulseDashboardStatesWidget[] =>
  dashboardLayoutWidgets(config).filter((widget): widget is PulseDashboardStatesWidget => widget.kind === "states");
