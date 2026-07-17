import { z } from "zod";
import { AssignedToFilterSchema, ItemTypeSchema, PrioritySchema } from "@/contracts";

export const CalendarFilterSchema = z.object({
  type: ItemTypeSchema,
  assignedTo: AssignedToFilterSchema,
  priorities: z.array(PrioritySchema),
  columnIds: z.array(z.string()),
  tagIds: z.array(z.string()),
});

export type CalendarFilter = z.infer<typeof CalendarFilterSchema>;

export const defaultCalendarFilter: CalendarFilter = {
  type: "all",
  assignedTo: "all",
  priorities: [],
  columnIds: [],
  tagIds: [],
};

const PARAMS = {
  type: "ctype",
  assignedTo: "cassigned",
  priorities: "cpriority",
  columns: "ccolumns",
  tags: "ctags",
} as const;

const values = (url: URL, key: string) => url.searchParams.get(key)?.split(",").filter(Boolean) ?? [];

/** Parses only known values; malformed or stale URL filters degrade to safe defaults. */
export const parseCalendarFilter = (url: URL): CalendarFilter => ({
  type: ItemTypeSchema.catch(defaultCalendarFilter.type).parse(url.searchParams.get(PARAMS.type)),
  assignedTo: AssignedToFilterSchema.catch(defaultCalendarFilter.assignedTo).parse(url.searchParams.get(PARAMS.assignedTo)),
  priorities: z.array(PrioritySchema).catch([]).parse(values(url, PARAMS.priorities)),
  columnIds: values(url, PARAMS.columns),
  tagIds: values(url, PARAMS.tags),
});

export const writeCalendarFilter = (url: URL, filter: CalendarFilter): void => {
  for (const key of Object.values(PARAMS)) url.searchParams.delete(key);
  if (filter.type !== defaultCalendarFilter.type) url.searchParams.set(PARAMS.type, filter.type);
  if (filter.assignedTo !== defaultCalendarFilter.assignedTo) url.searchParams.set(PARAMS.assignedTo, filter.assignedTo);
  if (filter.priorities.length > 0) url.searchParams.set(PARAMS.priorities, filter.priorities.join(","));
  if (filter.columnIds.length > 0) url.searchParams.set(PARAMS.columns, filter.columnIds.join(","));
  if (filter.tagIds.length > 0) url.searchParams.set(PARAMS.tags, filter.tagIds.join(","));
};
