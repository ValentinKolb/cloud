import { err, fail, ok } from "@k2b/stdlib";
import {
  type CapabilityExecutionContext,
  type CloudResourceView,
  capabilityPage,
  defineCapabilities,
  UniversalSearchDataSchema,
  type UniversalSearchInput,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { z } from "zod";
import { type VenueAccessScope, venueAccessScopeFor } from "./access-control";
import {
  AssignmentActionDataSchema,
  AssignmentCancelDataSchema,
  AssignmentCancelInputSchema,
  AssignmentDataSchema,
  AssignmentFreeSignupInputSchema,
  AssignmentListDataSchema,
  AssignmentMineInputSchema,
  AssignmentReadInputSchema,
  AssignmentSignupInputSchema,
  FeedbackSummaryDataSchema,
  ShiftDataSchema,
  ShiftListDataSchema,
  ShiftListInputSchema,
  ShiftReadInputSchema,
  VenueDataSchema,
  VenueListDataSchema,
  VenueListInputSchema,
  VenueReadInputSchema,
  VenueStatusDataSchema,
  VenueTargetInputSchema,
} from "./capability-contracts";
import type { ShiftAssignment, Venue } from "./contracts";
import { type UpcomingSlotSummary, venueService } from "./service";

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
  return { data, page: capabilityPage(hasMore ? encodeCursor(offset + data.length) : undefined) };
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
  return fail(err.notFound("Venue"));
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
  const page = pageResult(
    venues.map((venue) => ({
      ...mapVenue(venue),
      links: [{ rel: "open" as const, href: openVenueHref(venue) }],
    })),
    cursor.data,
    input.limit,
  );
  return ok({
    ...page,
    refs: page.data.map((venue) => ({ type: "venue.venue" as const, id: venue.id })),
  });
};

const runVenueRead = async (input: z.infer<typeof VenueReadInputSchema>, context: CapabilityExecutionContext) => {
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const venue = await requireVenue(input.id, scope.data, "read", true);
  if (!venue.ok) return venue;
  return ok({
    data: mapVenue(venue.data),
    refs: [{ type: "venue.venue", id: venue.data.id }],
    links: [{ rel: "open" as const, href: openVenueHref(venue.data) }],
  });
};

const runVenueStatus = async (input: z.infer<typeof VenueTargetInputSchema>, context: CapabilityExecutionContext) => {
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

const mapShift = (slot: UpcomingSlotSummary) => ({
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
  currentUserAssignmentId: slot.currentUserAssignmentId,
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
  const slots = await venueService.shifts.listSummary(venue.data, {
    startDate: input.startDate,
    days: input.days,
    templates,
    currentUserId: context.user?.id ?? null,
  });
  const page = pageResult(slots.slice(cursor.data, cursor.data + input.limit + 1).map(mapShift), cursor.data, input.limit);
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

const runAssignmentRead = async (input: z.infer<typeof AssignmentReadInputSchema>, context: CapabilityExecutionContext) => {
  if (!context.user) return fail(err.forbidden("Venue assignments require a user-backed actor"));
  const assignment = await venueService.assignments.getPersonalById(input.id, context.user.id);
  if (!assignment) return fail(err.notFound("Shift assignment"));
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const venue = await requireVenue(assignment.venueId, scope.data, "read");
  if (!venue.ok) return venue;
  return ok({
    data: mapPersonalAssignment(assignment),
    refs: [{ type: "venue.assignment", id: assignment.id }],
    links: [{ rel: "open" as const, href: myShiftsHref(assignment.venueId) }],
  });
};

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

const runFeedbackSummary = async (input: z.infer<typeof VenueTargetInputSchema>, context: CapabilityExecutionContext) => {
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

const parseShiftId = (shiftId: string) => {
  const match = SHIFT_ID_PATTERN.exec(shiftId);
  return match?.[1] && match[2] && z.iso.date().safeParse(match[2]).success
    ? ok({ templateId: match[1], date: match[2] })
    : fail(err.badInput("Invalid shiftId"));
};

const runShiftRead = async (input: z.infer<typeof ShiftReadInputSchema>, context: CapabilityExecutionContext) => {
  const parsed = parseShiftId(input.id);
  if (!parsed.ok) return parsed;
  const template = await venueService.templates.get(parsed.data.templateId);
  if (!template || !template.active) return fail(err.notFound("Shift"));
  const scope = scopeFor(context);
  if (!scope.ok) return scope;
  const venue = await requireVenue(template.venueId, scope.data, "read");
  if (!venue.ok) return venue;
  const slots = await venueService.shifts.listSummary(venue.data, {
    startDate: parsed.data.date,
    days: 1,
    templates: [template],
    currentUserId: context.user?.id ?? null,
  });
  const shift = slots.find((slot) => slot.key === input.id);
  return shift
    ? ok({
        data: mapShift(shift),
        refs: [{ type: "venue.shift", id: input.id }],
        links: [{ rel: "open" as const, href: shiftHref(venue.data.id) }],
      })
    : fail(err.notFound("Shift"));
};

const validateFreeSignupWindow = (input: z.infer<typeof AssignmentFreeSignupInputSchema>) => {
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  const duration = end.getTime() - start.getTime();
  if (start.getTime() < Date.now() - 60_000) return fail(err.badInput("Free shifts cannot start in the past"));
  if (duration < 60_000 || duration > 24 * 60 * 60 * 1_000) {
    return fail(err.badInput("Free shifts must last between one minute and 24 hours"));
  }
  if (start.getTime() > Date.now() + 366 * 86_400_000) return fail(err.badInput("Free shifts must start within the next 366 days"));
  return ok({ start, end });
};

const runAssignmentSignup = async (input: z.infer<typeof AssignmentSignupInputSchema>, context: CapabilityExecutionContext) => {
  const actor = await requireUserAndVenue(input.venueId, context, "write");
  if (!actor.ok) return actor;
  if (actor.data.venue.signupMode === "free") return fail(err.badInput("Template shift signup is disabled for this Venue"));
  const shift = parseShiftId(input.shiftId);
  if (!shift.ok) return shift;
  const result = await venueService.assignments.signupTemplate(
    actor.data.venue,
    shift.data.templateId,
    { date: shift.data.date },
    actor.data.user,
  );
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
  const window = validateFreeSignupWindow(input);
  if (!window.ok) return window;
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
  protocolVersion: 1,
  types: {
    venue: {
      title: "Venue",
      description: "A public or permission-scoped place with opening and staffing rules.",
      icon: "ti ti-building-carousel",
      reader: "venue.read",
    },
    shift: {
      title: "Venue shift",
      description: "One dated staffing slot generated from a Venue shift template.",
      icon: "ti ti-calendar-event",
      reader: "shift.read",
    },
    assignment: {
      title: "Shift assignment",
      description: "A user's concrete signup for a Venue shift.",
      icon: "ti ti-user-check",
      reader: "assignment.read",
    },
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
    "venue.read": {
      title: "Read Venue",
      description: "Read compact metadata for one public or accessible Venue without media or secret calendar tokens.",
      input: VenueReadInputSchema,
      data: VenueDataSchema,
      openWorld: false,
      run: runVenueRead,
    },
    "venue.status": {
      title: "Get Venue status",
      description: "Get current opening status, today's hours, and the next confirmed openings in the Venue timezone.",
      input: VenueTargetInputSchema,
      data: VenueStatusDataSchema,
      openWorld: false,
      run: runVenueStatus,
    },
    "shift.list": {
      title: "List Venue shifts",
      description: "Find and list dated Venue shifts for up to 31 days without exposing participant identities.",
      input: ShiftListInputSchema,
      data: ShiftListDataSchema,
      openWorld: false,
      run: runShiftList,
    },
    "shift.read": {
      title: "Read Venue shift",
      description: "Read one dated Venue shift by its stable ID.",
      input: ShiftReadInputSchema,
      data: ShiftDataSchema,
      openWorld: false,
      run: runShiftRead,
    },
    "assignment.mine": {
      title: "List my assignments",
      description: "List the current user-backed actor's own assignments in a bounded date range.",
      input: AssignmentMineInputSchema,
      data: AssignmentListDataSchema,
      openWorld: false,
      run: runAssignmentMine,
    },
    "assignment.read": {
      title: "Read my assignment",
      description: "Read one assignment owned by the current user-backed actor.",
      input: AssignmentReadInputSchema,
      data: AssignmentDataSchema,
      openWorld: false,
      run: runAssignmentRead,
    },
    "feedback.summary": {
      title: "Get Venue feedback summary",
      description: "Read bounded rating aggregates without loading anonymous feedback comments.",
      input: VenueTargetInputSchema,
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
      idempotency: "none",
      review: async (input, context) => {
        const actor = await requireUserAndVenue(input.venueId, context, "write");
        if (!actor.ok) return actor;
        if (actor.data.venue.signupMode === "free") return fail(err.badInput("Template shift signup is disabled for this Venue"));
        const parsed = parseShiftId(input.shiftId);
        if (!parsed.ok) return parsed;
        const templates = await venueService.templates.list(actor.data.venue.id, { limit: 101 });
        if (templates.length > 100) return fail(err.badInput("This Venue has too many active shift templates"));
        const shifts = await venueService.shifts.listSummary(actor.data.venue, {
          startDate: parsed.data.date,
          days: 1,
          templates,
          currentUserId: actor.data.user.id,
        });
        const shift = shifts.find((entry) => entry.key === input.shiftId);
        if (!shift) return fail(err.notFound("Shift"));
        if (shift.currentUserAssignmentId) return fail(err.badInput("You are already signed up for this shift"));
        if (shift.full) return fail(err.badInput("This shift is already full"));
        return ok({
          message: `Sign up for ${shift.template.title} at ${actor.data.venue.name}.`,
          details: [
            { label: "Venue", value: actor.data.venue.name },
            { label: "Shift", value: shift.template.title },
            { label: "Starts", value: shift.startsAt },
            { label: "Ends", value: shift.endsAt },
          ],
          links: [{ rel: "open" as const, href: shiftHref(actor.data.venue.id) }],
        });
      },
      run: runAssignmentSignup,
    },
    "assignment.signup_free": {
      title: "Sign up for free Venue shift",
      description: "Create one non-idempotent free assignment with exact instants, for at most 24 hours within the next year.",
      input: AssignmentFreeSignupInputSchema,
      data: AssignmentActionDataSchema,
      destructive: false,
      openWorld: false,
      idempotency: "none",
      review: async (input, context) => {
        const actor = await requireUserAndVenue(input.venueId, context, "write");
        if (!actor.ok) return actor;
        if (actor.data.venue.signupMode === "templates") return fail(err.badInput("Free shift signup is disabled for this Venue"));
        const window = validateFreeSignupWindow(input);
        if (!window.ok) return window;
        return ok({
          message: `Create a free shift assignment at ${actor.data.venue.name}.`,
          details: [
            { label: "Venue", value: actor.data.venue.name },
            { label: "Timezone", value: actor.data.venue.timezone },
            { label: "Starts", value: window.data.start.toISOString() },
            { label: "Ends", value: window.data.end.toISOString() },
          ],
          links: [{ rel: "open" as const, href: myShiftsHref(actor.data.venue.id) }],
        });
      },
      run: runAssignmentFreeSignup,
    },
    "assignment.cancel": {
      title: "Cancel my shift assignment",
      description: "Delete only the current user-backed actor's own assignment. This action is not idempotent.",
      input: AssignmentCancelInputSchema,
      data: AssignmentCancelDataSchema,
      destructive: true,
      openWorld: false,
      idempotency: "none",
      review: async (input, context) => {
        const actor = await requireUserAndVenue(input.venueId, context, "read");
        if (!actor.ok) return actor;
        const assignment = await venueService.assignments.getPersonal(actor.data.venue.id, input.assignmentId, actor.data.user.id);
        if (!assignment) return fail(err.notFound("Shift assignment"));
        return ok({
          message: `Cancel your shift assignment at ${actor.data.venue.name}.`,
          details: [
            { label: "Venue", value: actor.data.venue.name },
            { label: "Starts", value: assignment.startsAt },
            { label: "Ends", value: assignment.endsAt },
          ],
          links: [{ rel: "open" as const, href: myShiftsHref(actor.data.venue.id) }],
        });
      },
      run: runAssignmentCancel,
    },
  },
});
