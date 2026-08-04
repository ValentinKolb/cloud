import { z } from "zod";

const TimestampSchema = z.string().datetime({ offset: true });
const DateKeySchema = z.iso.date();
const CursorSchema = z.string().min(1).max(256).optional().describe("Opaque cursor returned by the previous page.");
const LimitSchema = z.number().int().min(1).max(100).default(25).describe("Maximum number of results to return.");
const VenueIdSchema = z.uuid().describe("Stable Venue UUID.");
const PageInputShape = { cursor: CursorSchema, limit: LimitSchema };

const VenueDataSchema = z
  .object({
    id: z.uuid(),
    slug: z.string().min(1).max(80),
    name: z.string().min(1).max(160),
    icon: z.string().min(1).max(120),
    description: z.string().max(1_000).nullable(),
    timezone: z.string().min(1).max(80),
    openMode: z.enum(["regular", "staffed", "combined"]),
    signupMode: z.enum(["templates", "free", "both"]),
    publicEnabled: z.boolean(),
    feedbackEnabled: z.boolean(),
    permission: z.enum(["read", "write", "admin"]).nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const VenueListInputSchema = z
  .object({
    query: z.string().trim().max(500).optional().describe("Optional Venue name, slug, or description search."),
    ...PageInputShape,
  })
  .strict();
export const VenueListDataSchema = z.array(VenueDataSchema).max(100);
export const VenueGetInputSchema = z.object({ venueId: VenueIdSchema }).strict();
export const VenueGetDataSchema = VenueDataSchema;

const PublicOpeningDataSchema = z
  .object({
    kind: z.enum(["regular", "shift", "free"]),
    title: z.string().min(1).max(160),
    startsAt: TimestampSchema,
    endsAt: TimestampSchema,
  })
  .strict();
export const VenueStatusDataSchema = z
  .object({
    venueId: z.uuid(),
    timezone: z.string().min(1).max(80),
    open: z.boolean(),
    spontaneousOpen: z.boolean(),
    statusLabel: z.string().min(1).max(160),
    todayLabel: z.string().min(1).max(500),
    nextOpeningLabel: z.string().max(500).nullable(),
    activeWindowLabel: z.string().max(500).nullable(),
    upcomingOpenings: z.array(PublicOpeningDataSchema).max(8),
  })
  .strict();

const ShiftDataSchema = z
  .object({
    id: z.string().min(1).max(512),
    venueId: z.uuid(),
    templateId: z.uuid(),
    title: z.string().min(1).max(160),
    date: DateKeySchema,
    startsAt: TimestampSchema,
    endsAt: TimestampSchema,
    assignedCount: z.number().int().nonnegative(),
    minPeople: z.number().int().nonnegative(),
    maxPeople: z.number().int().nonnegative().nullable(),
    missingPeople: z.number().int().nonnegative(),
    full: z.boolean(),
    currentUserAssignmentId: z.uuid().nullable(),
  })
  .strict();
export const ShiftListInputSchema = z
  .object({
    venueId: VenueIdSchema,
    startDate: DateKeySchema.optional().describe("First date in the Venue timezone; defaults to today."),
    days: z.number().int().min(1).max(31).default(14).describe("Number of Venue-local calendar days to include."),
    ...PageInputShape,
  })
  .strict();
export const ShiftListDataSchema = z.array(ShiftDataSchema).max(100);

const AssignmentDataSchema = z
  .object({
    id: z.uuid(),
    venueId: z.uuid(),
    venueName: z.string().min(1).max(160),
    venueTimezone: z.string().min(1).max(80),
    templateId: z.uuid().nullable(),
    startsAt: TimestampSchema,
    endsAt: TimestampSchema,
    note: z.string().max(500).nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export const AssignmentMineInputSchema = z
  .object({
    venueId: z.uuid().optional().describe("Optional Venue UUID filter."),
    from: TimestampSchema.optional().describe("Range start; defaults to now."),
    days: z.number().int().min(1).max(366).default(90).describe("Number of 24-hour periods after from to include."),
    ...PageInputShape,
  })
  .strict();
export const AssignmentListDataSchema = z.array(AssignmentDataSchema).max(100);

const FeedbackBucketDataSchema = z
  .object({ date: DateKeySchema, count: z.number().int().nonnegative(), averageRating: z.number().min(1).max(5).nullable() })
  .strict();
export const FeedbackSummaryDataSchema = z
  .object({
    venueId: z.uuid(),
    count: z.number().int().nonnegative(),
    averageRating: z.number().min(1).max(5).nullable(),
    buckets: z.array(FeedbackBucketDataSchema).max(31),
  })
  .strict();

export const AssignmentSignupInputSchema = z
  .object({
    venueId: VenueIdSchema,
    shiftId: z.string().min(1).max(512).describe("Dated shift ID returned by shift.list."),
  })
  .strict();
export const AssignmentFreeSignupInputSchema = z
  .object({
    venueId: VenueIdSchema,
    startsAt: TimestampSchema.describe("Exact RFC 3339 start instant with timezone offset."),
    endsAt: TimestampSchema.describe("Exact RFC 3339 end instant with timezone offset."),
    note: z.string().trim().max(500).nullable().optional().describe("Optional private note for this assignment."),
  })
  .strict();
export const AssignmentCancelInputSchema = z
  .object({ venueId: VenueIdSchema, assignmentId: z.uuid().describe("Own assignment UUID returned by assignment.mine.") })
  .strict();
export const AssignmentActionDataSchema = AssignmentDataSchema;
export const AssignmentCancelDataSchema = z.object({ assignmentId: z.uuid(), cancelled: z.literal(true) }).strict();
