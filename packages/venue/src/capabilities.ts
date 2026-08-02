import { err, fail, ok } from "@k2b/stdlib";
import {
  type CapabilityExecutionContext,
  type CloudResourceView,
  defineCapabilities,
  UniversalSearchDataSchema,
  type UniversalSearchInput,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import type { z } from "zod";
import { type VenueAccessScope, venueAccessScopeFor } from "./access-control";
import {
  AssignmentActionDataSchema,
  AssignmentCancelDataSchema,
  AssignmentCancelInputSchema,
  AssignmentFreeSignupInputSchema,
  AssignmentListDataSchema,
  AssignmentMineInputSchema,
  AssignmentSignupInputSchema,
  FeedbackSummaryDataSchema,
  ShiftListDataSchema,
  ShiftListInputSchema,
  VenueGetDataSchema,
  VenueGetInputSchema,
  VenueListDataSchema,
  VenueListInputSchema,
  VenueStatusDataSchema,
} from "./capability-contracts";
import type { ShiftAssignment, UpcomingSlot, Venue } from "./contracts";
import { venueService } from "./service";

const venueHref = (venueId: string): string => `/app/venue/${venueId}`;
const publicVenueHref = (slug: string): string => `/app/venue/public/${encodeURIComponent(slug)}`;
const visiblePermission = (venue: Venue) =>
  venue.permission === "read" || venue.permission === "write" || venue.permission === "admin" ? venue.permission : null;
const openVenueHref = (venue: Venue): string => (visiblePermission(venue) ? venueHref(venue.id) : publicVenueHref(venue.slug));
const shiftHref = (venueId: string): string => `${venueHref(venueId)}/shifts`;
const myShiftsHref = (venueId: string): string => `${venueHref(venueId)}/my-shifts`;

const encodeCursor = (offset: number): string => Buffer.from(JSON.stringify({ v: 1, offset }), "utf8").toString("base64url");

const decodeCursor = (cursor: string | undefined) => {
  if (!cursor) return ok(0);
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: unknown; offset?: unknown };
    return value.v === 1 && Number.isSafeInteger(value.offset) && Number(value.offset) >= 0 && Number(value.offset) <= 10_000
      ? ok(Number(value.offset))
      : fail(err.badInput("Invalid cursor"));
  } catch {
    return fail(err.badInput("Invalid cursor"));
  }
};

const pageResult = <T>(items: T[], offset: number, limit: number) => {
  const data = items.slice(0, limit);
  const hasMore = items.length > limit;
  return { data, page: { hasMore, ...(hasMore ? { nextCursor: encodeCursor(offset + data.length) } : {}) } };
};

const scopeFor = (context: CapabilityExecutionContext) => venueAccessScopeFor(context.actor, context.accessSubject);

const mapVenue = (venue: Venue) => ({
  id: venue.id,
  slug: venue.slug.slice(0, 80),
  name: venue.name.slice(0, 160),
  icon: venue.icon.slice(0, 120),
  description: venue.description?.slice(0, 1_000) ?? null,
  timezone: venue.timezone.slice(0, 80),
  openMode: venue.openMode,
  signupMode: venue.signupMode,
  publicEnabled: venue.publicEnabled,
  feedbackEnabled: venue.feedbackEnabled,
  permission: visiblePermission(venue),
  createdAt: venue.createdAt,
  updatedAt: venue.updatedAt,
});

const requireVenue = async (venueId: string, scope: VenueAccessScope, permission: "read" | "write", allowPublic = false) => {
  if (scope.serviceAccountResourceId && scope.serviceAccountResourceId !== venueId) return fail(err.forbidden("Access denied"));
  const venue = await venueService.venues.getSummary(venueId, scope);
  if (!venue) return fail(err.notFound("Venue"));
  const access = await venueService.access.require(venueId, scope, permission);
  if (access.ok || (allowPublic && venue.publicEnabled && !scope.serviceAccountResourceId)) return ok(venue);
  return access;
};

const runVenueSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const scope = scopeFor(context);
  if (!scope.ok) return ok({ data: [] });
  const [accessible, publicVenues] = await Promise.all([
    venueService.venues.discover(scope.data, { query: input.query, limit: input.limit }),
    scope.data.serviceAccountResourceId
      ? Promise.resolve([])
      : venueService.venues.discoverPublic({ query: input.query, limit: input.limit }),
  ]);
  const venues = new Map(publicVenues.map((venue) => [venue.id, venue]));
  for (const venue of accessible) venues.set(venue.id, venue);
  const data: CloudResourceView[] = [...venues.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, input.limit)
    .map((venue) => ({
      ref: { type: "venue.venue", id: venue.id },
      title: venue.name.slice(0, 500),
      preview: venue.description?.slice(0, 2_000),
      icon: venue.icon.slice(0, 120),
      priority: 7,
      metadata: [
        { label: "Timezone", value: venue.timezone.slice(0, 1_000) },
        { label: "Access", value: venue.permission ?? "Public" },
      ],
      links: [{ rel: "open", href: openVenueHref(venue) }],
    }));
  return ok({ data });
};

const runVenueList = async (input: z.infer<typeof VenueListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const venues = await venueService.venues.discover(scope.data, {
    query: input.query,
    limit: input.limit + 1,
    offset: cursor.data,
  });
  const page = pageResult(venues.map(mapVenue), cursor.data, input.limit);
  return ok({
    ...page,
    refs: page.data.map((venue) => ({ type: "venue.venue" as const, id: venue.id })),
  });
};

const runVenueGet = async (input: z.infer<typeof VenueGetInputSchema>, context: CapabilityExecutionContext) => {
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const venue = await requireVenue(input.venueId, scope.data, "read", true);
  if (!venue.ok) return venue;
  return ok({
    data: mapVenue(venue.data),
    refs: [{ type: "venue.venue", id: venue.data.id }],
    links: [{ rel: "open" as const, href: openVenueHref(venue.data) }],
  });
};

const runVenueStatus = async (input: z.infer<typeof VenueGetInputSchema>, context: CapabilityExecutionContext) => {
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const venue = await requireVenue(input.venueId, scope.data, "read", true);
  if (!venue.ok) return venue;
  const status = await venueService.status(venue.data, new Date(), false);
  return ok({
    data: {
      venueId: venue.data.id,
      timezone: venue.data.timezone.slice(0, 80),
      open: status.open,
      spontaneousOpen: status.spontaneousOpen,
      statusLabel: status.statusLabel.slice(0, 160),
      todayLabel: status.todayLabel.slice(0, 500),
      nextOpeningLabel: status.nextOpeningLabel?.slice(0, 500) ?? null,
      activeWindowLabel: status.activeWindowLabel?.slice(0, 500) ?? null,
      upcomingOpenings: status.upcomingOpenings.slice(0, 8).map((opening) => ({
        kind: opening.kind,
        title: opening.title.slice(0, 160),
        startsAt: opening.startsAt,
        endsAt: opening.endsAt,
      })),
    },
    refs: [{ type: "venue.venue", id: venue.data.id }],
    links: [{ rel: "status" as const, href: openVenueHref(venue.data) }],
  });
};

const mapShift = (slot: UpcomingSlot, currentUserId: string | null) => ({
  id: slot.key,
  venueId: slot.template.venueId,
  templateId: slot.template.id,
  title: slot.template.title.slice(0, 160),
  date: slot.date,
  startsAt: slot.startsAt,
  endsAt: slot.endsAt,
  assignedCount: slot.assignedCount,
  minPeople: slot.minPeople,
  maxPeople: slot.maxPeople,
  missingPeople: slot.missingPeople,
  full: slot.full,
  currentUserAssignmentId: slot.assignments.find((assignment) => assignment.userId === currentUserId)?.id ?? null,
});

const runShiftList = async (input: z.infer<typeof ShiftListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const venue = await requireVenue(input.venueId, scope.data, "read");
  if (!venue.ok) return venue;
  const templates = await venueService.templates.list(venue.data.id, { limit: 101 });
  if (templates.length > 100) return fail(err.badInput("This Venue has too many active shift templates"));
  const slots = await venueService.shifts.list(venue.data, { startDate: input.startDate, days: input.days, templates });
  const page = pageResult(
    slots.map((slot) => mapShift(slot, context.user?.id ?? null)),
    cursor.data,
    input.limit,
  );
  return ok({
    ...page,
    refs: page.data.map((shift) => ({ type: "venue.shift" as const, id: shift.id })),
    links: [{ rel: "open" as const, href: shiftHref(venue.data.id) }],
  });
};

type PersonalAssignment = Awaited<ReturnType<typeof venueService.assignments.mine>>[number];

const mapPersonalAssignment = (assignment: PersonalAssignment) => ({
  id: assignment.id,
  venueId: assignment.venueId,
  venueName: assignment.venueName.slice(0, 160),
  venueTimezone: assignment.venueTimezone.slice(0, 80),
  templateId: assignment.templateId,
  startsAt: assignment.startsAt,
  endsAt: assignment.endsAt,
  note: assignment.note?.slice(0, 500) ?? null,
  createdAt: assignment.createdAt,
  updatedAt: assignment.updatedAt,
});

const runAssignmentMine = async (input: z.infer<typeof AssignmentMineInputSchema>, context: CapabilityExecutionContext) => {
  if (!context.user) return fail(err.forbidden("Venue assignments require a user-backed actor"));
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  if (scope.data.serviceAccountResourceId && input.venueId && scope.data.serviceAccountResourceId !== input.venueId) {
    return fail(err.forbidden("Access denied"));
  }
  const venueId = scope.data.serviceAccountResourceId ?? input.venueId;
  if (scope.data.serviceAccountResourceId) {
    const venue = await requireVenue(scope.data.serviceAccountResourceId, scope.data, "read");
    if (!venue.ok) return venue;
  }
  const cursor = decodeCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const from = input.from ? new Date(input.from) : new Date();
  const to = new Date(from.getTime() + input.days * 86_400_000);
  const assignments = await venueService.assignments.mine(context.user.id, {
    venueId,
    from,
    to,
    limit: input.limit + 1,
    offset: cursor.data,
  });
  const page = pageResult(assignments.map(mapPersonalAssignment), cursor.data, input.limit);
  return ok({
    ...page,
    refs: page.data.map((assignment) => ({ type: "venue.assignment" as const, id: assignment.id })),
    ...(venueId ? { links: [{ rel: "open" as const, href: myShiftsHref(venueId) }] } : {}),
  });
};

const runFeedbackSummary = async (input: z.infer<typeof VenueGetInputSchema>, context: CapabilityExecutionContext) => {
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const venue = await requireVenue(input.venueId, scope.data, "read");
  if (!venue.ok) return venue;
  const feedback = await venueService.feedback.summary(venue.data.id, { summaryDays: 30 });
  return ok({
    data: {
      venueId: venue.data.id,
      count: feedback.summary.count,
      averageRating: feedback.summary.averageRating,
      buckets: feedback.summary.buckets.slice(0, 31),
    },
    refs: [{ type: "venue.venue", id: venue.data.id }],
    links: [{ rel: "open" as const, href: `${venueHref(venue.data.id)}/feedback` }],
  });
};

const requireUserAndVenue = async (venueId: string, context: CapabilityExecutionContext, permission: "read" | "write") => {
  if (!context.user) return fail(err.forbidden("Venue assignments require a user-backed actor"));
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const venue = await requireVenue(venueId, scope.data, permission);
  if (!venue.ok) return venue;
  return ok({ user: context.user, venue: venue.data });
};

const mapCreatedAssignment = (assignment: ShiftAssignment, venue: Venue) => ({
  id: assignment.id,
  venueId: assignment.venueId,
  venueName: venue.name.slice(0, 160),
  venueTimezone: venue.timezone.slice(0, 80),
  templateId: assignment.templateId,
  startsAt: assignment.startsAt,
  endsAt: assignment.endsAt,
  note: assignment.note?.slice(0, 500) ?? null,
  createdAt: assignment.createdAt,
  updatedAt: assignment.updatedAt,
});

const SHIFT_ID_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(\d{4}-\d{2}-\d{2})$/i;

const runAssignmentSignup = async (input: z.infer<typeof AssignmentSignupInputSchema>, context: CapabilityExecutionContext) => {
  const actor = await requireUserAndVenue(input.venueId, context, "write");
  if (!actor.ok) return actor;
  if (actor.data.venue.signupMode === "free") return fail(err.badInput("Template shift signup is disabled for this Venue"));
  const match = SHIFT_ID_PATTERN.exec(input.shiftId);
  if (!match?.[1] || !match[2]) return fail(err.badInput("Invalid shiftId"));
  const result = await venueService.assignments.signupTemplate(actor.data.venue, match[1], { date: match[2] }, actor.data.user);
  if (!result.ok) return result;
  return ok({
    data: mapCreatedAssignment(result.data, actor.data.venue),
    refs: [
      { type: "venue.venue", id: actor.data.venue.id },
      { type: "venue.shift", id: input.shiftId },
      { type: "venue.assignment", id: result.data.id },
    ],
    links: [{ rel: "open" as const, href: myShiftsHref(actor.data.venue.id) }],
  });
};

const runAssignmentFreeSignup = async (input: z.infer<typeof AssignmentFreeSignupInputSchema>, context: CapabilityExecutionContext) => {
  const actor = await requireUserAndVenue(input.venueId, context, "write");
  if (!actor.ok) return actor;
  if (actor.data.venue.signupMode === "templates") return fail(err.badInput("Free shift signup is disabled for this Venue"));
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  const duration = end.getTime() - start.getTime();
  if (start.getTime() < Date.now() - 60_000) return fail(err.badInput("Free shifts cannot start in the past"));
  if (duration < 60_000 || duration > 24 * 60 * 60 * 1_000) {
    return fail(err.badInput("Free shifts must last between one minute and 24 hours"));
  }
  if (start.getTime() > Date.now() + 366 * 86_400_000) return fail(err.badInput("Free shifts must start within the next 366 days"));
  const result = await venueService.assignments.signupFree(actor.data.venue.id, input, actor.data.user);
  if (!result.ok) return result;
  return ok({
    data: mapCreatedAssignment(result.data, actor.data.venue),
    refs: [
      { type: "venue.venue", id: actor.data.venue.id },
      { type: "venue.assignment", id: result.data.id },
    ],
    links: [{ rel: "open" as const, href: myShiftsHref(actor.data.venue.id) }],
  });
};

const runAssignmentCancel = async (input: z.infer<typeof AssignmentCancelInputSchema>, context: CapabilityExecutionContext) => {
  const actor = await requireUserAndVenue(input.venueId, context, "read");
  if (!actor.ok) return actor;
  const result = await venueService.assignments.cancel(actor.data.venue.id, input.assignmentId, actor.data.user, false);
  if (!result.ok) return result;
  return ok({
    data: { assignmentId: input.assignmentId, cancelled: true as const },
    refs: [{ type: "venue.venue", id: actor.data.venue.id }],
    links: [{ rel: "open" as const, href: myShiftsHref(actor.data.venue.id) }],
  });
};

export const venueCapabilities = defineCapabilities({
  version: 1,
  types: {
    venue: {
      title: "Venue",
      description: "A public or permission-scoped place with opening and staffing rules.",
      icon: "ti ti-building-carousel",
    },
    shift: {
      title: "Venue shift",
      description: "One dated staffing slot generated from a Venue shift template.",
      icon: "ti ti-calendar-event",
    },
    assignment: { title: "Shift assignment", description: "A user's concrete signup for a Venue shift.", icon: "ti ti-user-check" },
  },
  queries: {
    "venue.search": {
      title: "Search Venues",
      description: "Find public or accessible Venues by name, slug, or description.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      openWorld: false,
      universalSearch: { tags: [{ tag: "venue", title: "Venues", description: "Show Venues only.", aliases: ["venues", "place"] }] },
      run: runVenueSearch,
    },
    "venue.list": {
      title: "List accessible Venues",
      description: "Start here to list permission-scoped Venues and obtain stable venueId values.",
      input: VenueListInputSchema,
      data: VenueListDataSchema,
      openWorld: false,
      run: runVenueList,
    },
    "venue.get": {
      title: "Get Venue",
      description: "Read compact metadata for one public or accessible Venue without media or secret calendar tokens.",
      input: VenueGetInputSchema,
      data: VenueGetDataSchema,
      openWorld: false,
      run: runVenueGet,
    },
    "venue.status": {
      title: "Get Venue status",
      description: "Get current opening status, today's hours, and the next confirmed openings in the Venue timezone.",
      input: VenueGetInputSchema,
      data: VenueStatusDataSchema,
      openWorld: false,
      run: runVenueStatus,
    },
    "shift.list": {
      title: "List Venue shifts",
      description: "List dated staffing slots for up to 31 days without exposing participant identities.",
      input: ShiftListInputSchema,
      data: ShiftListDataSchema,
      openWorld: false,
      run: runShiftList,
    },
    "assignment.mine": {
      title: "List my shift assignments",
      description: "List the current user-backed actor's own assignments in a bounded date range.",
      input: AssignmentMineInputSchema,
      data: AssignmentListDataSchema,
      openWorld: false,
      run: runAssignmentMine,
    },
    "feedback.summary": {
      title: "Get Venue feedback summary",
      description: "Read bounded rating aggregates without loading anonymous feedback comments.",
      input: VenueGetInputSchema,
      data: FeedbackSummaryDataSchema,
      openWorld: false,
      run: runFeedbackSummary,
    },
  },
  actions: {
    "assignment.signup": {
      title: "Sign up for Venue shift",
      description: "Create one non-idempotent assignment for a dated shiftId returned by shift.list.",
      input: AssignmentSignupInputSchema,
      data: AssignmentActionDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "shift", inputField: "shiftId" },
      run: runAssignmentSignup,
    },
    "assignment.signup_free": {
      title: "Sign up for free Venue shift",
      description: "Create one non-idempotent free assignment with exact instants, for at most 24 hours within the next year.",
      input: AssignmentFreeSignupInputSchema,
      data: AssignmentActionDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "venue", inputField: "venueId" },
      run: runAssignmentFreeSignup,
    },
    "assignment.cancel": {
      title: "Cancel my shift assignment",
      description: "Delete only the current user-backed actor's own assignment. This action is not idempotent.",
      input: AssignmentCancelInputSchema,
      data: AssignmentCancelDataSchema,
      destructive: true,
      openWorld: false,
      approval: "always",
      idempotency: "none",
      target: { type: "assignment", inputField: "assignmentId" },
      run: runAssignmentCancel,
    },
  },
});
