import { z } from "zod";
import { PrioritySchema } from "./contracts";
import {
  CalendarAddressSchema,
  CalendarInvitationImportResultSchema,
  CalendarInvitationPreviewSchema,
  CalendarInvitationResponseSchema,
  CalendarInvitationResponseStateSchema,
  CalendarParticipationStatusSchema,
  SpacesMailDestinationsSchema,
} from "./integration";

const TimestampSchema = z.string().datetime({ offset: true });
const NullableTextSchema = z.string().nullable();
const CursorSchema = z.string().min(1).max(256).optional().describe("Opaque cursor returned by the previous page.");
const LimitSchema = z.number().int().min(1).max(100).default(25).describe("Maximum number of results to return.");
const QuerySchema = z.string().trim().max(500).optional().describe("Optional text search.");
const IdListSchema = z.array(z.uuid()).max(100);
const PageInputShape = { cursor: CursorSchema, limit: LimitSchema };

const SpaceColumnDataSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(50),
    color: z.string().max(100).nullable(),
    isDone: z.boolean(),
  })
  .strict();

const SpaceTagDataSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(30),
    color: z.string().min(1).max(100),
  })
  .strict();

export const SpaceSummaryDataSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(100),
    description: z.string().max(500).nullable(),
    color: z.string().min(1).max(100),
    permission: z.enum(["read", "write", "admin"]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const SpaceDetailDataSchema = SpaceSummaryDataSchema.extend({
  columns: z.array(SpaceColumnDataSchema).max(100),
  columnsTruncated: z.boolean(),
  tags: z.array(SpaceTagDataSchema).max(100),
  tagsTruncated: z.boolean(),
}).strict();

export const SpaceListInputSchema = z
  .object({
    query: QuerySchema,
    minimumPermission: z
      .enum(["read", "write", "admin"])
      .default("read")
      .describe("Minimum effective permission required for every returned Space."),
    ...PageInputShape,
  })
  .strict();

export const SpaceListDataSchema = z.array(SpaceSummaryDataSchema).max(100);
export const SpaceGetInputSchema = z.object({ spaceId: z.uuid().describe("Stable Space UUID.") }).strict();

const ItemAssigneeDataSchema = z.object({ id: z.uuid(), displayName: z.string().min(1).max(200) }).strict();
const ItemTagDataSchema = z.object({ id: z.uuid(), name: z.string().min(1).max(100), color: z.string().min(1).max(100) }).strict();

const ItemBaseDataShape = {
  id: z.uuid(),
  spaceId: z.uuid(),
  columnId: z.uuid(),
  title: z.string().min(1).max(200),
  titleTruncated: z.boolean(),
  description: z.string().max(5000).nullable(),
  descriptionTruncated: z.boolean(),
  completedAt: TimestampSchema.nullable(),
  assignees: z.array(ItemAssigneeDataSchema).max(100),
  tags: z.array(ItemTagDataSchema).max(100),
  relationsTruncated: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
};

export const TaskDataSchema = z
  .object({
    kind: z.literal("task"),
    ...ItemBaseDataShape,
    deadline: TimestampSchema.nullable(),
    priority: PrioritySchema.nullable(),
  })
  .strict();

const RecurrenceDataSchema = z
  .object({
    rrule: z.string().min(1).max(2000).describe("RFC 5545 recurrence rule without the RRULE prefix."),
    dtstart: TimestampSchema.nullable().optional().describe("Optional recurrence anchor timestamp."),
    exdate: z.array(TimestampSchema).max(1000).default([]).describe("Excluded recurrence timestamps."),
  })
  .strict();

export const EventDataSchema = z
  .object({
    kind: z.literal("event"),
    ...ItemBaseDataShape,
    location: z.string().max(500).nullable(),
    locationTruncated: z.boolean(),
    url: z.string().max(2000).nullable(),
    urlTruncated: z.boolean(),
    startsAt: TimestampSchema,
    endsAt: TimestampSchema,
    allDay: z.boolean(),
    recurrence: RecurrenceDataSchema.nullable(),
    recurrenceTruncated: z.boolean(),
    recurrenceExceptionsTruncated: z.boolean(),
  })
  .strict();

export const ItemDataSchema = z.discriminatedUnion("kind", [TaskDataSchema, EventDataSchema]);
const ItemListBaseDataShape = {
  id: z.uuid(),
  spaceId: z.uuid(),
  columnId: z.uuid(),
  title: z.string().min(1).max(200),
  descriptionPreview: z.string().max(1000).nullable(),
  descriptionTruncated: z.boolean(),
  completedAt: TimestampSchema.nullable(),
  assignees: z.array(z.object({ id: z.uuid(), displayName: z.string().min(1).max(100) }).strict()).max(3),
  tags: z.array(z.object({ id: z.uuid(), name: z.string().min(1).max(50), color: z.string().min(1).max(20) }).strict()).max(3),
  relationsTruncated: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
};
export const TaskListItemDataSchema = z
  .object({ kind: z.literal("task"), ...ItemListBaseDataShape, deadline: TimestampSchema.nullable(), priority: PrioritySchema.nullable() })
  .strict();
export const EventListItemDataSchema = z
  .object({
    kind: z.literal("event"),
    ...ItemListBaseDataShape,
    location: z.string().max(200).nullable(),
    locationTruncated: z.boolean(),
    url: z.string().max(500).nullable(),
    urlTruncated: z.boolean(),
    startsAt: TimestampSchema,
    endsAt: TimestampSchema,
    allDay: z.boolean(),
    hasRecurrence: z.boolean(),
  })
  .strict();
export const TaskListDataSchema = z.array(TaskListItemDataSchema).max(100);
export const EventListDataSchema = z.array(EventListItemDataSchema).max(100);

const ItemListBaseShape = {
  spaceId: z.uuid().describe("Space whose items should be listed."),
  query: QuerySchema,
  status: z.enum(["active", "completed", "all"]).default("active").describe("Completion-state filter."),
  priority: z.array(PrioritySchema).max(4).optional().describe("Optional priority filter."),
  columnIds: IdListSchema.optional().describe("Optional Space column UUID filter."),
  tagIds: IdListSchema.optional().describe("Optional Space tag UUID filter."),
  assigneeIds: IdListSchema.optional().describe("Optional assignee user UUID filter."),
  assignedTo: z
    .enum(["all", "assigned", "me", "unassigned"])
    .default("all")
    .describe("Assignment-state filter; me uses the user backing the current actor."),
  sort: z.enum(["column", "priority", "deadline", "created", "updated", "title"]).default("updated").describe("Stable item sort key."),
  sortDesc: z.boolean().default(true).describe("Sort descending when true."),
  ...PageInputShape,
};

export const TaskListInputSchema = z.object(ItemListBaseShape).strict();
export const EventListInputSchema = z.object(ItemListBaseShape).strict();
export const ItemGetInputSchema = z.object({ itemId: z.uuid().describe("Stable Space item UUID.") }).strict();

export const SpaceAssigneeListInputSchema = z
  .object({
    spaceId: z.uuid().describe("Writable Space whose assignable members should be listed."),
    query: QuerySchema,
    limit: LimitSchema,
  })
  .strict();
export const SpaceAssigneeDataSchema = z
  .object({ id: z.uuid(), displayName: z.string().min(1).max(200), description: z.string().max(300) })
  .strict();
export const SpaceAssigneeListDataSchema = z.array(SpaceAssigneeDataSchema).max(100);

const ItemRelationInputShape = {
  assigneeIds: IdListSchema.optional().describe("Complete replacement set of assignee user UUIDs from this Space."),
  tagIds: IdListSchema.optional().describe("Complete replacement set of tag UUIDs from this Space."),
};

const TaskFieldsInputShape = {
  title: z.string().trim().min(1).max(200).optional().describe("Optional task title."),
  description: z.string().max(5000).nullable().optional().describe("Optional task description; null clears it."),
  deadline: TimestampSchema.nullable().optional().describe("Optional task deadline; null clears it."),
  priority: PrioritySchema.nullable().optional().describe("Optional task priority; null clears it."),
};

export const TaskCreateInputSchema = z
  .object({
    spaceId: z.uuid().describe("Writable Space UUID."),
    columnId: z.uuid().describe("Target column UUID in the selected Space."),
    title: z.string().trim().min(1).max(200).describe("Task title."),
    description: z.string().max(5000).optional().describe("Optional task description."),
    deadline: TimestampSchema.optional().describe("Optional task deadline."),
    priority: PrioritySchema.optional().describe("Optional task priority."),
    assigneeIds: IdListSchema.optional().describe("Optional assignee user UUIDs from this Space."),
    tagIds: IdListSchema.optional().describe("Optional tag UUIDs from this Space."),
  })
  .strict();

export const TaskUpdateInputSchema = z
  .object({ itemId: z.uuid().describe("Stable task item UUID."), ...ItemRelationInputShape, ...TaskFieldsInputShape })
  .strict()
  .refine(({ itemId: _itemId, ...changes }) => Object.values(changes).some((value) => value !== undefined), {
    message: "At least one task field must be provided",
  });

const EventFieldsInputShape = {
  title: z.string().trim().min(1).max(200).optional().describe("Optional event title."),
  description: z.string().max(5000).nullable().optional().describe("Optional event description; null clears it."),
  location: z.string().max(500).nullable().optional().describe("Optional event location; null clears it."),
  url: z.string().url().max(2000).nullable().optional().describe("Optional event URL; null clears it."),
  startsAt: TimestampSchema.optional().describe("Replacement event start; provide together with endsAt."),
  endsAt: TimestampSchema.optional().describe("Replacement event end; provide together with startsAt."),
  allDay: z.boolean().optional().describe("Whether the event uses all-day presentation."),
  recurrence: RecurrenceDataSchema.nullable().optional().describe("Optional recurrence series; null removes recurrence."),
};

const validTimeRange = (value: { startsAt?: string; endsAt?: string }) =>
  value.startsAt === undefined || value.endsAt === undefined || new Date(value.endsAt) > new Date(value.startsAt);

export const EventCreateInputSchema = z
  .object({
    spaceId: z.uuid().describe("Writable Space UUID."),
    columnId: z.uuid().describe("Target column UUID in the selected Space."),
    title: z.string().trim().min(1).max(200).describe("Event title."),
    description: z.string().max(5000).optional().describe("Optional event description."),
    location: z.string().max(500).optional().describe("Optional event location."),
    url: z.string().url().max(2000).optional().describe("Optional event URL."),
    startsAt: TimestampSchema.describe("Event start timestamp."),
    endsAt: TimestampSchema.describe("Event end timestamp after startsAt."),
    allDay: z.boolean().optional().describe("Whether the event uses all-day presentation."),
    recurrence: RecurrenceDataSchema.optional().describe("Optional recurrence series."),
    assigneeIds: IdListSchema.optional().describe("Optional assignee user UUIDs from this Space."),
    tagIds: IdListSchema.optional().describe("Optional tag UUIDs from this Space."),
  })
  .strict()
  .refine(validTimeRange, { message: "End time must be after start time", path: ["endsAt"] });

export const EventUpdateInputSchema = z
  .object({ itemId: z.uuid().describe("Stable event item UUID."), ...ItemRelationInputShape, ...EventFieldsInputShape })
  .strict()
  .refine(({ itemId: _itemId, ...changes }) => Object.values(changes).some((value) => value !== undefined), {
    message: "At least one event field must be provided",
  })
  .refine((value) => (value.startsAt === undefined) === (value.endsAt === undefined), {
    message: "startsAt and endsAt must be updated together",
    path: ["endsAt"],
  })
  .refine(validTimeRange, { message: "End time must be after start time", path: ["endsAt"] });

export const TaskSetCompletedInputSchema = z
  .object({
    itemId: z.uuid().describe("Stable task item UUID."),
    completed: z.boolean().describe("True completes the task; false reopens it."),
  })
  .strict();
export const ItemDeleteInputSchema = z.object({ itemId: z.uuid().describe("Stable task or event item UUID.") }).strict();
export const ItemDeleteDataSchema = z.object({ itemId: z.uuid(), deleted: z.literal(true) }).strict();

export const CommentDataSchema = z
  .object({
    id: z.uuid(),
    itemId: z.uuid(),
    recurrenceId: TimestampSchema.nullable(),
    userId: z.uuid().nullable(),
    userName: NullableTextSchema,
    content: z.string().min(1).max(5000),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    canDelete: z.boolean(),
  })
  .strict();

export const CommentListInputSchema = z
  .object({
    itemId: z.uuid().describe("Item whose discussion should be listed."),
    recurrenceId: TimestampSchema.optional().describe("Optional recurring occurrence timestamp; omit for the item or whole series."),
    query: QuerySchema,
    ...PageInputShape,
  })
  .strict();

export const CommentListItemDataSchema = CommentDataSchema.omit({ content: true }).extend({
  content: z.string().min(1).max(1000),
  contentTruncated: z.boolean(),
});
export const CommentListDataSchema = z.array(CommentListItemDataSchema).max(100);
export const CommentGetInputSchema = z.object({ commentId: z.uuid().describe("Stable comment UUID.") }).strict();
export const CommentCreateInputSchema = z
  .object({
    itemId: z.uuid().describe("Writable parent item UUID."),
    recurrenceId: TimestampSchema.optional().describe("Optional recurring occurrence timestamp."),
    content: z.string().trim().min(1).max(5000).describe("Comment content."),
  })
  .strict();
export const CommentUpdateInputSchema = z
  .object({
    commentId: z.uuid().describe("Stable UUID of the current user's comment."),
    content: z.string().trim().min(1).max(5000).describe("Replacement comment content."),
  })
  .strict();
export const CommentDeleteInputSchema = z
  .object({ commentId: z.uuid().describe("Stable UUID of the current user's recent comment.") })
  .strict();

export const CalendarInvitationPreviewCapabilityInputSchema = z
  .object({
    mailboxId: z.uuid().describe("Source Mail mailbox UUID."),
    messageId: z.uuid().describe("Source Mail message UUID."),
    calendar: z
      .string()
      .min(1)
      .max(96 * 1024)
      .describe("Raw iCalendar invitation content, limited to 96 KiB."),
  })
  .strict();
export const CalendarInvitationPreviewCapabilityDataSchema = CalendarInvitationPreviewSchema;
export const CalendarInvitationResponsePrepareInputSchema = CalendarInvitationPreviewCapabilityInputSchema.extend({
  attendee: CalendarAddressSchema.describe("Mailbox identity responding to the invitation."),
  participationStatus: CalendarParticipationStatusSchema.describe("Invitation response to prepare."),
}).strict();
export const CalendarInvitationResponsePrepareDataSchema = CalendarInvitationResponseSchema;
export const CalendarInvitationImportCapabilityInputSchema = CalendarInvitationPreviewCapabilityInputSchema.extend({
  spaceId: z.uuid().describe("Writable destination Space UUID."),
}).strict();
export const CalendarInvitationImportCapabilityDataSchema = CalendarInvitationImportResultSchema;
export const CalendarInvitationResponseCommitCapabilityInputSchema = z
  .object({
    mailboxId: z.uuid().describe("Source Mail mailbox UUID."),
    messageId: z.uuid().describe("Source Mail message UUID."),
    participationStatus: CalendarParticipationStatusSchema.describe("Response saved in Spaces."),
    draftId: z.uuid().describe("Mail draft UUID created from the prepared response."),
  })
  .strict();
export const CalendarInvitationResponseCommitCapabilityDataSchema = CalendarInvitationResponseStateSchema;
export const CalendarDestinationListInputSchema = z.object({}).strict();
export const CalendarDestinationListDataSchema = SpacesMailDestinationsSchema;
export const EventInvitationPrepareInputSchema = z
  .object({
    itemId: z.uuid().describe("Writable event item UUID."),
    mailboxId: z.uuid().describe("Mail mailbox owning the target draft."),
    draftId: z.uuid().describe("Existing Mail draft that will receive the invitation."),
    senderIdentityId: z.uuid().describe("Verified Mail sender identity used as organizer."),
    organizer: CalendarAddressSchema.describe("Organizer derived from the verified Mail sender identity."),
    attendees: z.array(CalendarAddressSchema).min(1).max(200).describe("Visible To and Cc recipients derived from the current Mail draft."),
  })
  .strict();
export const EventInvitationPrepareDataSchema = z
  .object({
    deliveryId: z.uuid(),
    itemId: z.uuid(),
    mailboxId: z.uuid(),
    draftId: z.uuid(),
    sequence: z.number().int().nonnegative(),
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255),
    calendar: z
      .string()
      .min(1)
      .max(96 * 1024),
  })
  .strict();
export const EventInvitationCommitInputSchema = z.object({ deliveryId: z.uuid().describe("Prepared invitation delivery UUID.") }).strict();
export const EventInvitationCommitDataSchema = z
  .object({ deliveryId: z.uuid(), itemId: z.uuid(), draftId: z.uuid(), state: z.literal("drafted") })
  .strict();
export const CommentDeleteDataSchema = z.object({ commentId: z.uuid(), deleted: z.literal(true) }).strict();
