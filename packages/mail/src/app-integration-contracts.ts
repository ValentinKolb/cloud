import { z } from "zod";

const timestampSchema = z.string().datetime({ offset: true });
const nullableTextSchema = z.string().nullable();

export const normalizedContactEmailSchema = z.email().max(320);
const contactPointEmailSchema = z.object({ label: nullableTextSchema, email: z.email() }).passthrough();
const contactPointPhoneSchema = z.object({ label: nullableTextSchema, phone: z.string().min(1) }).passthrough();

export const contactResolveMatchSchema = z
  .object({
    contactId: z.uuid(),
    bookId: z.string().min(1),
    bookName: z.string().min(1),
    displayName: z.string().min(1),
    companyName: nullableTextSchema,
    jobTitle: nullableTextSchema,
    matchedEmails: z.array(normalizedContactEmailSchema).min(1).max(100),
    emails: z.array(contactPointEmailSchema).max(20),
    phones: z.array(contactPointPhoneSchema).max(20),
    contactPointsTruncated: z.boolean(),
    openHref: z.string().startsWith("/app/contacts/"),
    updatedAt: timestampSchema,
  })
  .passthrough();

export const contactResolveDataSchema = z
  .object({
    items: z.array(contactResolveMatchSchema).max(50),
    matchedEmails: z.array(normalizedContactEmailSchema).max(100),
  })
  .passthrough();

export const contactSuggestionSchema = z
  .object({
    contactId: z.uuid(),
    bookId: z.string().min(1),
    displayName: z.string().min(1),
    companyName: nullableTextSchema,
    jobTitle: nullableTextSchema,
    emails: z.array(contactPointEmailSchema).min(1).max(20),
    phones: z.array(contactPointPhoneSchema).max(20),
    contactPointsTruncated: z.boolean(),
    openHref: z.string().startsWith("/app/contacts/"),
    updatedAt: timestampSchema,
  })
  .passthrough();
export const contactSuggestionsSchema = z.array(contactSuggestionSchema).max(25);

export const contactBookSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    description: nullableTextSchema,
    permission: z.enum(["read", "write", "admin"]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .passthrough();
export const contactBooksSchema = z.array(contactBookSchema).max(100);

const contactDetailSchema = z
  .object({
    id: z.uuid(),
    bookId: z.string().min(1),
    displayName: z.string().min(1),
    companyName: nullableTextSchema,
    jobTitle: nullableTextSchema,
    emails: z.array(contactPointEmailSchema).max(100),
    phones: z.array(contactPointPhoneSchema).max(100),
    updatedAt: timestampSchema,
  })
  .passthrough();
export const contactMutationDataSchema = z.object({ contact: contactDetailSchema }).passthrough();

export const calendarAddressSchema = z.object({ name: z.string().max(500).nullable(), address: z.email().max(320) }).passthrough();
export type CalendarAddress = z.infer<typeof calendarAddressSchema>;
export const calendarParticipationStatusSchema = z.enum(["accepted", "tentative", "declined"]);
export type CalendarParticipationStatus = z.infer<typeof calendarParticipationStatusSchema>;

const calendarAttendeeSchema = calendarAddressSchema.extend({
  participationStatus: z.enum(["needs_action", "accepted", "tentative", "declined", "delegated", "unknown"]),
  role: z.enum(["required", "optional", "chair", "unknown"]),
  responseRequested: z.boolean(),
});
const calendarInvitationSchema = z
  .object({
    method: z.enum(["request", "cancel", "reply", "publish", "unknown"]),
    uid: z.string().min(1).max(1024),
    sequence: z.number().int().nonnegative(),
    status: z.enum(["confirmed", "tentative", "cancelled", "unknown"]),
    title: z.string().min(1).max(200),
    description: z.string().max(5000).nullable(),
    location: z.string().max(500).nullable(),
    url: z.url().max(2000).nullable(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    allDay: z.boolean(),
    recurrenceRule: z.string().max(4096).nullable(),
    organizer: calendarAddressSchema.nullable(),
    attendees: z.array(calendarAttendeeSchema).max(500),
  })
  .passthrough();
const calendarResponseStateSchema = z
  .object({
    participationStatus: calendarParticipationStatusSchema,
    state: z.literal("drafted"),
    draftId: z.uuid(),
    updatedAt: z.string().datetime(),
  })
  .passthrough();
export const calendarInvitationPreviewSchema = z
  .object({
    invitation: calendarInvitationSchema,
    response: calendarResponseStateSchema.nullable(),
    existing: z
      .object({
        itemId: z.uuid(),
        spaceId: z.uuid(),
        href: z.string().startsWith("/app/spaces/"),
        sequence: z.number().int().nonnegative(),
        method: z.enum(["request", "cancel", "reply", "publish", "unknown"]),
      })
      .passthrough()
      .nullable(),
  })
  .passthrough();
export type CalendarInvitationPreview = z.infer<typeof calendarInvitationPreviewSchema>;

export const calendarInvitationImportResultSchema = z
  .object({
    itemId: z.uuid(),
    spaceId: z.uuid(),
    href: z.string().startsWith("/app/spaces/"),
    outcome: z.enum(["created", "updated", "unchanged", "cancelled"]),
  })
  .passthrough();
export type CalendarInvitationImportResult = z.infer<typeof calendarInvitationImportResultSchema>;

export const calendarInvitationResponseSchema = z
  .object({
    to: calendarAddressSchema,
    subject: z.string().min(1).max(998),
    body: z.string().max(20_000),
    calendar: z
      .string()
      .min(1)
      .max(96 * 1024),
  })
  .passthrough();
export const calendarResponseStateDataSchema = calendarResponseStateSchema;

export const spacesMailDestinationSchema = z
  .object({ id: z.uuid(), name: z.string().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })
  .passthrough();
export const spacesMailDestinationsSchema = z.array(spacesMailDestinationSchema).max(500);
export const spacesMailDestinationContextSchema = z
  .object({ selectedSpaceId: z.uuid().nullable(), items: spacesMailDestinationsSchema })
  .passthrough();
export type SpacesMailDestinationContext = z.infer<typeof spacesMailDestinationContextSchema>;

const spaceColumnSchema = z.object({ id: z.uuid(), name: z.string().min(1), color: nullableTextSchema, isDone: z.boolean() }).passthrough();
export const spaceDetailSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    description: nullableTextSchema,
    color: z.string().min(1),
    permission: z.enum(["read", "write", "admin"]),
    columns: z.array(spaceColumnSchema).max(100),
    columnsTruncated: z.boolean(),
  })
  .passthrough();

const relationSchema = z.object({ id: z.uuid(), displayName: z.string().min(1) }).passthrough();
const itemTagSchema = z.object({ id: z.uuid(), name: z.string().min(1), color: z.string().min(1) }).passthrough();
export const calendarEventSchema = z
  .object({
    kind: z.literal("event"),
    id: z.uuid(),
    spaceId: z.uuid(),
    columnId: z.uuid(),
    title: z.string().min(1),
    description: nullableTextSchema,
    completedAt: timestampSchema.nullable(),
    assignees: z.array(relationSchema).max(100),
    tags: z.array(itemTagSchema).max(100),
    relationsTruncated: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    location: nullableTextSchema,
    url: z.string().nullable(),
    startsAt: timestampSchema,
    endsAt: timestampSchema,
    allDay: z.boolean(),
    recurrence: z
      .object({
        rrule: z.string().min(1).max(2000),
        dtstart: timestampSchema.nullable().optional(),
        exdate: z.array(timestampSchema).max(1000),
      })
      .passthrough()
      .nullable(),
    recurrenceExceptionsTruncated: z.boolean(),
  })
  .passthrough();
export const calendarEventsSchema = z.array(calendarEventSchema).max(100);
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const eventInvitationPrepareDataSchema = z
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
  .passthrough();
export const eventInvitationCommitDataSchema = z
  .object({ deliveryId: z.uuid(), itemId: z.uuid(), draftId: z.uuid(), state: z.literal("drafted") })
  .passthrough();
