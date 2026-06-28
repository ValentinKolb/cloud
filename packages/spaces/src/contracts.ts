import { z } from "zod";

// PostgreSQL uuid text format (accepts PostgreSQL's broader non-RFC version/variant values too).
const SpaceUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const SpaceSchema = z.object({
  id: SpaceUuidSchema.describe("Space UUID"),
  name: z.string().describe("Space name"),
  description: z.string().nullable().describe("Space description"),
  color: z.string().describe("Space color (hex)"),
  icalToken: z.string().nullable().describe("iCal export token"),
  createdAt: z.string().describe("Creation timestamp (ISO)"),
  updatedAt: z.string().describe("Last update timestamp (ISO)"),
});
export type Space = z.infer<typeof SpaceSchema>;

export const SpaceColumnSchema = z.object({
  id: SpaceUuidSchema.describe("Column UUID"),
  spaceId: SpaceUuidSchema.describe("Parent space UUID"),
  name: z.string().describe("Column name"),
  color: z.string().nullable().describe("Column color (hex)"),
  rank: z.string().describe("Column ordering rank"),
  isDone: z.boolean().describe("Items in this column are considered done"),
});
export type SpaceColumn = z.infer<typeof SpaceColumnSchema>;

export const SpaceTagSchema = z.object({
  id: SpaceUuidSchema.describe("Tag UUID"),
  spaceId: SpaceUuidSchema.describe("Parent space UUID"),
  name: z.string().describe("Tag name"),
  color: z.string().describe("Tag color (hex)"),
});
export type SpaceTag = z.infer<typeof SpaceTagSchema>;

export const PrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const RecurrenceSchema = z.object({
  rrule: z.string().min(1).describe("RFC 5545 RRULE string"),
  dtstart: z.string().nullable().optional().describe("Recurrence series start timestamp (ISO)"),
  exdate: z.array(z.string()).default([]).describe("Excluded recurrence instance timestamps (ISO)"),
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const SpaceItemAssigneeSchema = z.object({
  id: SpaceUuidSchema.describe("User UUID"),
  displayName: z.string().describe("User display name"),
  avatarHash: z.string().nullable().describe("User avatar hash"),
});
export type SpaceItemAssignee = z.infer<typeof SpaceItemAssigneeSchema>;

export const SpaceAssignableUserSchema = SpaceItemAssigneeSchema.extend({
  description: z.string().optional().describe("Short source hint for the picker"),
});
export type SpaceAssignableUser = z.infer<typeof SpaceAssignableUserSchema>;

export const SpaceItemSchema = z.object({
  id: SpaceUuidSchema.describe("Item UUID"),
  spaceId: SpaceUuidSchema.describe("Parent space UUID"),
  columnId: SpaceUuidSchema.describe("Current column UUID"),
  title: z.string().describe("Item title"),
  description: z.string().nullable().describe("Item description (markdown)"),
  location: z.string().nullable().describe("Event location"),
  url: z.string().nullable().describe("Event URL"),
  startsAt: z.string().nullable().describe("Event start time (ISO)"),
  endsAt: z.string().nullable().describe("Event end time (ISO)"),
  allDay: z.boolean().default(false).describe("Whether the item is an all-day event"),
  deadline: z.string().nullable().describe("Todo deadline (ISO)"),
  priority: PrioritySchema.nullable().describe("Item priority"),
  recurrence: RecurrenceSchema.nullable().describe("Recurring event series data"),
  recurringEventId: SpaceUuidSchema.nullable().describe("Parent recurring event UUID for overrides"),
  recurrenceId: z.string().nullable().describe("Original occurrence timestamp (ISO) for overrides"),
  rank: z.string().describe("Item ordering rank within a column"),
  completedAt: z.string().nullable().describe("Completion timestamp (ISO)"),
  createdBy: SpaceUuidSchema.nullable().describe("Creator user UUID"),
  createdAt: z.string().describe("Creation timestamp (ISO)"),
  updatedAt: z.string().describe("Last update timestamp (ISO)"),
  // Optional relations (loaded on demand)
  assignees: z.array(SpaceItemAssigneeSchema).optional().describe("Assigned users"),
  tags: z.array(SpaceTagSchema).optional().describe("Attached tags"),
});
export type SpaceItem = z.infer<typeof SpaceItemSchema>;

export const SpaceCommentSchema = z.object({
  id: SpaceUuidSchema.describe("Comment UUID"),
  itemId: SpaceUuidSchema.describe("Parent item UUID"),
  userId: SpaceUuidSchema.nullable().describe("Author user UUID"),
  userName: z.string().nullable().describe("Author display name"),
  userAvatarHash: z.string().nullable().describe("Author avatar hash"),
  content: z.string().describe("Comment content"),
  createdAt: z.string().describe("Creation timestamp (ISO)"),
  updatedAt: z.string().describe("Last update timestamp (ISO)"),
  canDelete: z.boolean().describe("Whether the current viewer may delete this comment"),
});
export type SpaceComment = z.infer<typeof SpaceCommentSchema>;

// Space with columns and tags (for detail view)
export const SpaceDetailSchema = SpaceSchema.extend({
  columns: z.array(SpaceColumnSchema).describe("Space columns"),
  tags: z.array(SpaceTagSchema).describe("Space tags"),
});
export type SpaceDetail = z.infer<typeof SpaceDetailSchema>;

// Calendar item (for calendar view)
export const CalendarItemSchema = z.object({
  id: z.string().describe("Calendar item ID; recurring instances use a stable virtual ID"),
  spaceId: SpaceUuidSchema.describe("Parent space UUID"),
  spaceName: z.string().describe("Space name"),
  spaceColor: z.string().describe("Space color"),
  title: z.string().describe("Item title"),
  location: z.string().nullable().describe("Event location"),
  url: z.string().nullable().describe("Event URL"),
  startsAt: z.string().nullable().describe("Event start time (ISO)"),
  endsAt: z.string().nullable().describe("Event end time (ISO)"),
  allDay: z.boolean().default(false).describe("Whether the item is an all-day event"),
  deadline: z.string().nullable().describe("Todo deadline (ISO)"),
  priority: PrioritySchema.nullable().describe("Item priority"),
  recurrence: RecurrenceSchema.nullable().describe("Recurring event series data"),
  recurringEventId: SpaceUuidSchema.nullable().describe("Parent recurring event UUID for overrides"),
  recurrenceId: z.string().nullable().describe("Original occurrence timestamp (ISO) for overrides"),
  isRecurringInstance: z.boolean().optional().describe("Whether this calendar item is an expanded recurring instance"),
  tags: z.array(SpaceTagSchema).optional().describe("Attached tags"),
});
export type CalendarItem = z.infer<typeof CalendarItemSchema>;

// Overlap result
export const OverlapItemSchema = z.object({
  itemId: SpaceUuidSchema.describe("Overlapping item UUID"),
  spaceId: SpaceUuidSchema.describe("Space UUID"),
  spaceName: z.string().describe("Space name"),
  title: z.string().describe("Item title"),
  startsAt: z.string().describe("Event start time (ISO)"),
  endsAt: z.string().describe("Event end time (ISO)"),
});
export type OverlapItem = z.infer<typeof OverlapItemSchema>;

// === Input Schemas ===

export const CreateSpaceSchema = z.object({
  name: z.string().min(1).max(100).describe("Space name"),
  description: z.string().max(500).optional().describe("Space description"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#3b82f6")
    .describe("Space color (hex)"),
});
export type CreateSpace = z.infer<typeof CreateSpaceSchema>;

export const UpdateSpaceSchema = z.object({
  name: z.string().min(1).max(100).optional().describe("Space name"),
  description: z.string().max(500).nullable().optional().describe("Space description"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe("Space color (hex)"),
});
export type UpdateSpace = z.infer<typeof UpdateSpaceSchema>;

export const CreateColumnSchema = z.object({
  name: z.string().min(1).max(50).describe("Column name"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe("Column color (hex)"),
  isDone: z.boolean().default(false).describe("Items in this column are considered done"),
});
export type CreateColumn = z.infer<typeof CreateColumnSchema>;

export const UpdateColumnSchema = z.object({
  name: z.string().min(1).max(50).optional().describe("Column name"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional()
    .describe("Column color (hex)"),
  isDone: z.boolean().optional().describe("Items in this column are considered done"),
});
export type UpdateColumn = z.infer<typeof UpdateColumnSchema>;

export const ReorderColumnsSchema = z.object({
  columnIds: z.array(SpaceUuidSchema).describe("Column IDs in new order"),
});
export type ReorderColumns = z.infer<typeof ReorderColumnsSchema>;

export const CreateTagSchema = z.object({
  name: z.string().min(1).max(30).describe("Tag name"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .describe("Tag color (hex)"),
});
export type CreateTag = z.infer<typeof CreateTagSchema>;

export const UpdateTagSchema = z.object({
  name: z.string().min(1).max(30).optional().describe("Tag name"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe("Tag color (hex)"),
});
export type UpdateTag = z.infer<typeof UpdateTagSchema>;

export const CreateItemSchema = z
  .object({
    columnId: SpaceUuidSchema.describe("Target column UUID"),
    title: z.string().min(1).max(200).describe("Item title"),
    description: z.string().max(5000).optional().describe("Item description (markdown)"),
    location: z.string().max(500).optional().describe("Event location"),
    url: z.string().url().max(2000).optional().describe("Event URL"),
    startsAt: z.string().datetime().optional().describe("Event start time (ISO)"),
    endsAt: z.string().datetime().optional().describe("Event end time (ISO)"),
    allDay: z.boolean().optional().describe("Whether the item is an all-day event"),
    deadline: z.string().datetime().optional().describe("Todo deadline (ISO)"),
    priority: PrioritySchema.optional().describe("Item priority"),
    recurrence: RecurrenceSchema.optional().describe("Recurring event series data"),
    recurringEventId: SpaceUuidSchema.optional().describe("Parent recurring event UUID for overrides"),
    recurrenceId: z.string().datetime().optional().describe("Original occurrence timestamp (ISO) for overrides"),
    assigneeIds: z.array(SpaceUuidSchema).optional().describe("Assigned user UUIDs"),
    tagIds: z.array(SpaceUuidSchema).optional().describe("Tag UUIDs"),
  })
  .refine((data) => !data.startsAt || !data.endsAt || new Date(data.endsAt) > new Date(data.startsAt), {
    message: "End time must be after start time",
    path: ["endsAt"],
  });
export type CreateItem = z.infer<typeof CreateItemSchema>;

export const UpdateItemSchema = z
  .object({
    columnId: SpaceUuidSchema.optional().describe("Target column UUID"),
    title: z.string().min(1).max(200).optional().describe("Item title"),
    description: z.string().max(5000).nullable().optional().describe("Item description (markdown)"),
    location: z.string().max(500).nullable().optional().describe("Event location"),
    url: z.string().url().max(2000).nullable().optional().describe("Event URL"),
    startsAt: z.string().datetime().nullable().optional().describe("Event start time (ISO)"),
    endsAt: z.string().datetime().nullable().optional().describe("Event end time (ISO)"),
    allDay: z.boolean().optional().describe("Whether the item is an all-day event"),
    deadline: z.string().datetime().nullable().optional().describe("Todo deadline (ISO)"),
    priority: PrioritySchema.nullable().optional().describe("Item priority"),
    recurrence: RecurrenceSchema.nullable().optional().describe("Recurring event series data"),
    recurringEventId: SpaceUuidSchema.nullable().optional().describe("Parent recurring event UUID for overrides"),
    recurrenceId: z.string().datetime().nullable().optional().describe("Original occurrence timestamp (ISO) for overrides"),
    assigneeIds: z.array(SpaceUuidSchema).optional().describe("Assigned user UUIDs"),
    tagIds: z.array(SpaceUuidSchema).optional().describe("Tag UUIDs"),
  })
  .refine((data) => !data.startsAt || !data.endsAt || new Date(data.endsAt) > new Date(data.startsAt), {
    message: "End time must be after start time",
    path: ["endsAt"],
  });
export type UpdateItem = z.infer<typeof UpdateItemSchema>;

export const MoveItemSchema = z.object({
  columnId: SpaceUuidSchema.describe("Target column UUID"),
  rank: z
    .string()
    .regex(/^-?\d+$/)
    .describe("Target rank value"),
  completed: z.boolean().optional().describe("Optional completion state override after move"),
});
export type MoveItem = z.infer<typeof MoveItemSchema>;

export const SetCompletedSchema = z.object({
  completed: z.boolean().describe("Completion status"),
});
export type SetCompleted = z.infer<typeof SetCompletedSchema>;

export const CreateCommentSchema = z.object({
  content: z.string().min(1).max(5000).describe("Comment content"),
});
export type CreateComment = z.infer<typeof CreateCommentSchema>;

export const UpdateCommentSchema = z.object({
  content: z.string().min(1).max(5000).describe("Comment content"),
});
export type UpdateComment = z.infer<typeof UpdateCommentSchema>;

export const CalendarQuerySchema = z
  .object({
    from: z.string().datetime().describe("Start of date range (ISO)"),
    to: z.string().datetime().describe("End of date range (ISO)"),
  })
  .refine((data) => new Date(data.to) > new Date(data.from), {
    message: "End time must be after start time",
    path: ["to"],
  });
export type CalendarQuery = z.infer<typeof CalendarQuerySchema>;

export const OverlapQuerySchema = z
  .object({
    from: z.string().datetime().describe("Start of time range (ISO)"),
    to: z.string().datetime().describe("End of time range (ISO)"),
    excludeItemId: SpaceUuidSchema.optional().describe("Item to exclude from check"),
  })
  .refine((data) => new Date(data.to) > new Date(data.from), {
    message: "End time must be after start time",
    path: ["to"],
  });
export type OverlapQuery = z.infer<typeof OverlapQuerySchema>;

// === Item Filter/Sort/Pagination ===

export const ItemTypeSchema = z.enum(["all", "task", "event"]);
export type ItemType = z.infer<typeof ItemTypeSchema>;

export const ItemStatusSchema = z.enum(["active", "completed", "all"]);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

export const DeadlineFilterSchema = z.enum(["all", "overdue", "today", "week", "none"]);
export type DeadlineFilter = z.infer<typeof DeadlineFilterSchema>;

export const ItemSortSchema = z.enum(["column", "priority", "deadline", "created", "updated", "title"]);
export type ItemSort = z.infer<typeof ItemSortSchema>;

export const ItemGroupBySchema = z.enum(["column", "priority", "tag", "deadline", "none"]);
export type ItemGroupBy = z.infer<typeof ItemGroupBySchema>;

export const AssignedToFilterSchema = z.enum(["all", "assigned", "me", "unassigned"]);
export type AssignedToFilter = z.infer<typeof AssignedToFilterSchema>;

export const ItemFilterSchema = z.object({
  // Filter options
  type: ItemTypeSchema.default("all").describe("Filter by item type"),
  status: ItemStatusSchema.default("active").describe("Filter by completion status"),
  priority: z.array(PrioritySchema).optional().describe("Filter by priorities"),
  tagIds: z.array(SpaceUuidSchema).optional().describe("Filter by tag IDs"),
  assigneeIds: z.array(SpaceUuidSchema).optional().describe("Filter by assignee IDs"),
  assignedTo: AssignedToFilterSchema.default("all").describe("Filter by assignment: all, me, or unassigned"),
  columnIds: z.array(SpaceUuidSchema).optional().describe("Filter by column IDs"),
  deadlineFilter: DeadlineFilterSchema.default("all").describe("Filter by deadline range"),
  search: z.string().optional().describe("Search in title and description"),

  // Sort options
  sort: ItemSortSchema.default("deadline").describe("Sort field"),
  sortDesc: z.boolean().default(false).describe("Sort descending"),

  // Grouping
  groupBy: ItemGroupBySchema.default("priority").describe("Group items by field"),

  // Pagination
  page: z.number().int().min(1).default(1).describe("Page number (1-indexed)"),
  pageSize: z.number().int().min(1).max(100).default(50).describe("Items per page"),
});
export type ItemFilter = z.infer<typeof ItemFilterSchema>;

export const ItemListResultSchema = z.object({
  items: z.array(SpaceItemSchema).describe("Items matching the filter"),
  total: z.number().int().describe("Total number of matching items"),
  page: z.number().int().describe("Current page"),
  pageSize: z.number().int().describe("Items per page"),
  totalPages: z.number().int().describe("Total number of pages"),
});
export type ItemListResult = z.infer<typeof ItemListResultSchema>;

export type {
  AccessEntry,
  MessageResponse,
  MutationResult,
  PermissionLevel,
  Principal,
  User,
} from "@valentinkolb/cloud/contracts";
export {
  AccessEntrySchema,
  ErrorResponseSchema,
  GrantAccessSchema,
  hasRole,
  MessageResponseSchema,
  PermissionLevelSchema,
  PrincipalSchema,
  UpdateAccessSchema,
} from "@valentinkolb/cloud/contracts";
