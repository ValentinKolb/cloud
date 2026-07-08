import { dates as calendar, type DateContext } from "@valentinkolb/stdlib";
import type { FilterTree, RecordDisplayConfig } from "../../../contracts";
import type { Field, GridRecord } from "../../../service";
import type { RecordsState } from "./query-url";

export type GridsCalendarView = RecordsState["calendar"]["view"];

export const activeDisplayConfig = (
  tableDisplayConfig: RecordDisplayConfig,
  viewDisplayConfig?: RecordDisplayConfig | null,
): RecordDisplayConfig => viewDisplayConfig ?? tableDisplayConfig ?? { mode: "table" };

export const cardImageFieldIds = (displayConfig: RecordDisplayConfig): string[] => {
  const fieldId = displayConfig.mode === "cards" ? displayConfig.cards?.imageFieldId : null;
  return fieldId ? [fieldId] : [];
};

const calendarRange = (state: RecordsState["calendar"], dateConfig?: DateContext) => {
  const calendarDate = calendar.parseCalendarDate(state.date, dateConfig);
  const year = Number(calendar.formatDateKey(calendarDate, dateConfig).slice(0, 4));
  if (state.view === "day") return { from: calendarDate, to: calendar.addDays(calendarDate, 1, dateConfig) };
  if (state.view === "year") {
    if (dateConfig?.timeZone) {
      return {
        from: new Date(calendar.zonedDateTimeToInstant(`${year}-01-01T00:00`, dateConfig.timeZone, { disambiguation: "compatible" })),
        to: new Date(calendar.zonedDateTimeToInstant(`${year + 1}-01-01T00:00`, dateConfig.timeZone, { disambiguation: "compatible" })),
      };
    }
    return { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1) };
  }
  return calendar.getDateRange(state.view, calendarDate, dateConfig);
};

const addDaysToKey = (dateKey: string, days: number, dateConfig?: DateContext) =>
  calendar.formatDateKey(calendar.addDays(calendar.parseCalendarDate(dateKey, dateConfig), days, dateConfig), dateConfig);

const rangeToDateBounds = (from: Date, to: Date, dateConfig?: DateContext): [string, string] => {
  const fromKey = calendar.formatDateKey(from, dateConfig);
  const toExclusiveKey = calendar.formatDateKey(to, dateConfig);
  return [fromKey, addDaysToKey(toExclusiveKey, -1, dateConfig)];
};

const rangeToDateTimeBounds = (from: Date, to: Date): [string, string] => [from.toISOString(), to.toISOString()];

export const calendarQueryFilter = (args: {
  baseFilter?: FilterTree;
  fields: Field[];
  displayConfig: RecordDisplayConfig;
  calendar: RecordsState["calendar"];
  dateConfig?: DateContext;
}): FilterTree | undefined => {
  if (args.displayConfig.mode !== "calendar") return args.baseFilter;
  const dateFieldId = args.displayConfig.calendar?.dateFieldId;
  const dateField = dateFieldId
    ? args.fields.find((field) => field.id === dateFieldId && field.type === "date" && !field.deletedAt)
    : undefined;
  if (!dateField) return args.baseFilter;

  const { from, to } = calendarRange(args.calendar, args.dateConfig);
  const includeTime = Boolean((dateField.config as { includeTime?: boolean }).includeTime);
  const bounds = includeTime ? rangeToDateTimeBounds(from, to) : rangeToDateBounds(from, to, args.dateConfig);
  const rangeFilter: FilterTree = { fieldId: dateField.id, op: "between", value: bounds };
  return args.baseFilter ? { op: "AND", filters: [args.baseFilter, rangeFilter] } : rangeFilter;
};

const sameFilter = (a: FilterTree | undefined, b: FilterTree | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

export const removeCalendarQueryFilter = (args: {
  queryFilter?: FilterTree;
  fields: Field[];
  displayConfig: RecordDisplayConfig;
  calendar: RecordsState["calendar"];
  dateConfig?: DateContext;
}): FilterTree | undefined => {
  const calendarFilter = calendarQueryFilter({
    fields: args.fields,
    displayConfig: args.displayConfig,
    calendar: args.calendar,
    dateConfig: args.dateConfig,
  });
  if (!calendarFilter) return args.queryFilter;
  if (sameFilter(args.queryFilter, calendarFilter)) return undefined;
  if (!args.queryFilter || args.queryFilter.op !== "AND" || !("filters" in args.queryFilter)) return args.queryFilter;
  const filters = args.queryFilter.filters.filter((filter) => !sameFilter(filter, calendarFilter));
  if (filters.length === args.queryFilter.filters.length) return args.queryFilter;
  if (filters.length === 0) return undefined;
  return filters.length === 1 ? filters[0] : { op: "AND", filters };
};

export const displayRecordTitle = (record: GridRecord, fields: Field[]): string => {
  const candidates = fields.filter((field) => field.presentable && !field.deletedAt);
  const fallback =
    candidates.length > 0 ? candidates : fields.filter((field) => !field.deletedAt && ["text", "id", "select"].includes(field.type));
  for (const field of fallback) {
    const value = record.data[field.id];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return record.id.slice(0, 8);
};

export const visibleCardFields = (fields: Field[], displayConfig: RecordDisplayConfig): Field[] => {
  const live = fields.filter((field) => !field.deletedAt);
  const ids = displayConfig.cards?.fieldIds ?? [];
  if (ids.length > 0) {
    const byId = new Map(live.map((field) => [field.id, field]));
    return ids.flatMap((id) => {
      const field = byId.get(id);
      return field ? [field] : [];
    });
  }
  return live
    .filter((field) => !field.hideInTable && field.type !== "file")
    .sort((a, b) => a.position - b.position)
    .slice(0, 4);
};
