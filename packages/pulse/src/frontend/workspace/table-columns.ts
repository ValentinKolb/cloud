import type { DataTableColumn } from "@valentinkolb/cloud/ui";
import type { PulseCurrentState, PulseMetricSeries, PulseMetricSummary, PulseRecordedEvent } from "../../contracts";
import type { ActivityEventGroup, ActivityStateGroup } from "./types";

export const eventColumns: DataTableColumn<PulseRecordedEvent>[] = [
  { id: "kind", header: "Event", value: "kind", cellClass: "min-w-52" },
  { id: "subject", header: "Subject", cellClass: "min-w-56" },
  { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
  { id: "dimensions", header: "Dimensions", cellClass: "min-w-56" },
  { id: "value", header: "Value", cellClass: "w-24 whitespace-nowrap" },
  { id: "time", header: "Time", cellClass: "w-44 whitespace-nowrap" },
];

export const eventGroupColumns: DataTableColumn<ActivityEventGroup>[] = [
  { id: "kind", header: "Event", value: "kind", cellClass: "min-w-52" },
  { id: "subject", header: "Subject", value: "subject", cellClass: "min-w-56" },
  { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
  { id: "value", header: "Latest value", cellClass: "min-w-32 whitespace-nowrap" },
  { id: "count", header: "Rows", cellClass: "w-20 whitespace-nowrap" },
  { id: "time", header: "Latest", cellClass: "w-44 whitespace-nowrap" },
];

export const stateColumns: DataTableColumn<PulseCurrentState>[] = [
  { id: "key", header: "State", value: "key", cellClass: "min-w-52" },
  { id: "value", header: "Value", cellClass: "min-w-40" },
  { id: "subject", header: "Subject", cellClass: "min-w-56" },
  { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
  { id: "dimensions", header: "Dimensions", cellClass: "min-w-56" },
  { id: "updated", header: "Updated", cellClass: "w-44 whitespace-nowrap" },
];

export const stateGroupColumns: DataTableColumn<ActivityStateGroup>[] = [
  { id: "key", header: "State", value: "key", cellClass: "min-w-52" },
  { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
  { id: "value", header: "Latest value", cellClass: "min-w-40" },
  { id: "updated", header: "Latest", cellClass: "w-44 whitespace-nowrap" },
];

export const metricColumns: DataTableColumn<PulseMetricSummary>[] = [
  { id: "name", header: "Metric", value: "name", cellClass: "min-w-72" },
  { id: "type", header: "Type", value: "type", cellClass: "w-24 whitespace-nowrap" },
  { id: "unit", header: "Unit", cellClass: "w-24 whitespace-nowrap" },
  { id: "sources", header: "Sources", cellClass: "w-24 whitespace-nowrap" },
  { id: "resources", header: "Resources", cellClass: "w-28 whitespace-nowrap" },
  { id: "series", header: "Variants", cellClass: "w-24 whitespace-nowrap" },
  { id: "lastSeen", header: "Last seen", cellClass: "w-44 whitespace-nowrap" },
];

export const metricSeriesColumns: DataTableColumn<PulseMetricSeries>[] = [
  { id: "subject", header: "Subject", cellClass: "min-w-56" },
  { id: "current", header: "Current", cellClass: "w-32 whitespace-nowrap" },
  { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
  { id: "dimensions", header: "Dimensions", cellClass: "min-w-56" },
  { id: "lastSeen", header: "Last seen", cellClass: "w-44 whitespace-nowrap" },
];
