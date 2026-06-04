import type { WidgetResponse } from "@valentinkolb/cloud/contracts";
import {
  AccessEntrySchema,
  ErrorResponseSchema,
  GrantAccessSchema,
  MessageResponseSchema,
  type PermissionLevel,
  UpdateAccessSchema,
} from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, err, fail, jsonResponse, ok, rateLimit, respond, v } from "@valentinkolb/cloud/server";
import { coreSettings } from "@valentinkolb/cloud/services";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  DateOverrideInputSchema,
  FeedbackEntrySchema,
  FeedbackInputSchema,
  FreeSignupInputSchema,
  OpeningRuleInputSchema,
  PublicSectionInputSchema,
  PublicStatusSchema,
  ShiftAssignmentSchema,
  ShiftTemplateInputSchema,
  TemplateSignupInputSchema,
  UpcomingSlotSchema,
  VenueDashboardSchema,
  VenueInputSchema,
  VenueSchema,
  VenueTemplateCreateInputSchema,
  VenueTemplateSummarySchema,
} from "../contracts";
import { venueService } from "../service";

const VenueIdParamSchema = z.object({ id: z.string().uuid() });
const AccessParamSchema = z.object({ id: z.string().uuid(), accessId: z.string().uuid() });
const ResourceParamSchema = z.object({ id: z.string().uuid(), resourceId: z.string().uuid() });
const TemplateParamSchema = z.object({ id: z.string().uuid(), templateId: z.string().uuid() });
const AssignmentParamSchema = z.object({ id: z.string().uuid(), assignmentId: z.string().uuid() });
const PublicSlugParamSchema = z.object({ slug: z.string().min(1).max(80) });
const TokenParamSchema = z.object({ token: z.string().min(16).max(128) });
const VenueTemplateParamSchema = z.object({ templateId: z.string().min(1).max(80) });
const TemplateWeeksInputSchema = TemplateSignupInputSchema.extend({ weeks: z.number().int().min(1).max(12).default(4) });

const requireVenue = async (id: string, user: AuthContext["Variables"]["user"], permission: PermissionLevel) => {
  const venue = await venueService.venues.get(id, user);
  if (!venue) return fail(err.notFound("Venue"));
  const allowed = await venueService.access.require(id, user, permission);
  if (!allowed.ok) return allowed;
  return ok(venue);
};

const readVenue = async (id: string, user: AuthContext["Variables"]["user"]) => requireVenue(id, user, "read");
const writeVenue = async (id: string, user: AuthContext["Variables"]["user"]) => requireVenue(id, user, "write");
const adminVenue = async (id: string, user: AuthContext["Variables"]["user"]) => requireVenue(id, user, "admin");

const root = new Hono<AuthContext>();
// biome-ignore format: check-service-api-contracts requires a leading `.use(...)` line before route handlers.
root
  .use(rateLimit());

const widgetRoutes = new Hono<AuthContext>().get("/today", auth.requireRole("authenticated"), async (c) => {
  const user = c.get("user");
  const venues = await venueService.venues.list(user);
  const venue = venues[0];
  if (!venue) return c.body(null, 204);

  const status = await venueService.publicStatus(venue.slug);
  const dashboard = await venueService.dashboard(venue, user);
  const nextShift = dashboard.myUpcomingShifts[0];
  const missing = dashboard.slots.reduce((sum, slot) => sum + slot.missingPeople, 0);

  const response: WidgetResponse = {
    title: venue.name,
    icon: venue.icon || "ti ti-building-carousel",
    href: `/app/venue/${venue.id}`,
    meta: status?.statusLabel ?? "Venue",
    blocks: [
      {
        kind: "status",
        tone: status?.open ? "ok" : "info",
        title: status?.statusLabel ?? "Status unavailable",
        message: status?.todayLabel ?? "No public status",
        icon: status?.open ? "ti ti-door-gate-open" : "ti ti-door",
      },
      {
        kind: "stat",
        label: "Open registrations",
        value: missing,
        sub: missing === 1 ? "registration still needed" : "registrations still needed",
        accent: missing > 0 ? { tone: "amber", icon: "ti ti-user-plus" } : { tone: "emerald", icon: "ti ti-check" },
      },
      nextShift
        ? {
            kind: "list",
            items: [
              {
                icon: "ti ti-calendar-event",
                label: "Your next shift",
                sub: new Date(nextShift.startsAt).toLocaleString(),
                href: `/app/venue/${venue.id}`,
              },
            ],
          }
        : { kind: "hero", title: "No upcoming shifts", icon: "ti ti-calendar-off", tone: "zinc" },
    ],
  };
  return respond(c, ok(response));
});

const calendarRoutes = new Hono<AuthContext>()
  .get("/my", auth.requireRole("authenticated"), async (c) => {
    const token = await venueService.ical.getOrCreateToken(c.get("user").id);
    const appUrl = await coreSettings.get<string>("app.url");
    return respond(c, ok({ href: `${appUrl}/api/venue/calendar/${token}.ics` }));
  })
  .get("/:token", v("param", TokenParamSchema), async (c) => {
    const raw = c.req.valid("param").token;
    const token = raw.endsWith(".ics") ? raw.slice(0, -4) : raw;
    const userId = await venueService.ical.getUserIdByToken(token);
    if (!userId) return respond(c, fail(err.notFound("Calendar")));
    const content = await venueService.ical.generateUser(userId, await coreSettings.get<string>("app.url"));
    return c.text(content, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="venue-shifts.ics"',
    });
  });

const venueTemplateRoutes = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .get(
    "/",
    describeRoute({
      tags: ["Venues:Templates"],
      summary: "List built-in venue templates",
      responses: { 200: jsonResponse(z.array(VenueTemplateSummarySchema), "Templates") },
    }),
    (c) => respond(c, ok(venueService.venueTemplates.list())),
  )
  .post(
    "/:templateId",
    describeRoute({
      tags: ["Venues:Templates"],
      summary: "Create a venue from a built-in template",
      responses: {
        201: jsonResponse(VenueSchema, "Created venue"),
        400: jsonResponse(ErrorResponseSchema, "Invalid template"),
        404: jsonResponse(ErrorResponseSchema, "Template not found"),
      },
    }),
    v("param", VenueTemplateParamSchema),
    v("json", VenueTemplateCreateInputSchema),
    async (c) =>
      respond(c, () => venueService.venueTemplates.instantiate(c.req.valid("param").templateId, c.req.valid("json"), c.get("user")), 201),
  );

const publicRoutes = new Hono<AuthContext>()
  .get(
    "/:slug/status",
    describeRoute({
      tags: ["Public"],
      summary: "Get public venue status",
      responses: {
        200: jsonResponse(PublicStatusSchema, "Public venue status"),
        404: jsonResponse(ErrorResponseSchema, "Venue not found"),
      },
    }),
    v("param", PublicSlugParamSchema),
    async (c) => {
      const status = await venueService.publicStatus(c.req.valid("param").slug);
      return status ? respond(c, ok(status)) : respond(c, fail(err.notFound("Venue")));
    },
  )
  .post(
    "/:slug/feedback",
    rateLimit({ limitPerSecond: 1, windowSecs: 60, keyBy: "ip" }),
    v("param", PublicSlugParamSchema),
    v("json", FeedbackInputSchema),
    async (c) => {
      const venue = await venueService.venues.getBySlug(c.req.valid("param").slug);
      if (!venue) return respond(c, fail(err.notFound("Venue")));
      return respond(c, () => venueService.feedback.create(venue.id, c.req.valid("json")), 201);
    },
  );

const venueRoutes = new Hono<AuthContext>()
  .use("*", auth.requireRole("authenticated"))
  .get(
    "/",
    describeRoute({
      tags: ["Venues"],
      summary: "List accessible venues",
      responses: { 200: jsonResponse(z.object({ venues: z.array(VenueSchema) }), "Accessible venues") },
    }),
    async (c) => respond(c, ok({ venues: await venueService.venues.list(c.get("user")) })),
  )
  .post(
    "/",
    describeRoute({
      tags: ["Venues"],
      summary: "Create venue",
      responses: { 201: jsonResponse(VenueSchema, "Created venue"), 400: jsonResponse(ErrorResponseSchema, "Invalid venue") },
    }),
    v("json", VenueInputSchema),
    async (c) => respond(c, () => venueService.venues.create(c.req.valid("json"), c.get("user")), 201),
  )
  .get("/:id/dashboard", v("param", VenueIdParamSchema), async (c) => {
    const venue = await readVenue(c.req.valid("param").id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, ok(await venueService.dashboard(venue.data, c.get("user"))));
  })
  .patch("/:id", v("param", VenueIdParamSchema), v("json", VenueInputSchema), async (c) => {
    const venue = await adminVenue(c.req.valid("param").id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.venues.update(venue.data.id, c.req.valid("json")));
  })
  .get("/:id/access", v("param", VenueIdParamSchema), async (c) => {
    const venue = await adminVenue(c.req.valid("param").id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, ok({ entries: await venueService.access.list(venue.data.id) }));
  })
  .post("/:id/access", v("param", VenueIdParamSchema), v("json", GrantAccessSchema), async (c) => {
    const venue = await adminVenue(c.req.valid("param").id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    const body = c.req.valid("json");
    return respond(c, () => venueService.access.grant(venue.data.id, body.principal, body.permission), 201);
  })
  .patch("/:id/access/:accessId", v("param", AccessParamSchema), v("json", UpdateAccessSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.access.update(venue.data.id, param.accessId, c.req.valid("json").permission));
  })
  .delete("/:id/access/:accessId", v("param", AccessParamSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.access.revoke(venue.data.id, param.accessId));
  })
  .post("/:id/opening-rules", v("param", VenueIdParamSchema), v("json", OpeningRuleInputSchema), async (c) => {
    const venue = await adminVenue(c.req.valid("param").id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.openingRules.create(venue.data.id, c.req.valid("json")), 201);
  })
  .patch("/:id/opening-rules/:resourceId", v("param", ResourceParamSchema), v("json", OpeningRuleInputSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.openingRules.update(venue.data.id, param.resourceId, c.req.valid("json")));
  })
  .delete("/:id/opening-rules/:resourceId", v("param", ResourceParamSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.openingRules.delete(venue.data.id, param.resourceId));
  })
  .post("/:id/overrides", v("param", VenueIdParamSchema), v("json", DateOverrideInputSchema), async (c) => {
    const venue = await adminVenue(c.req.valid("param").id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.overrides.upsert(venue.data.id, c.req.valid("json")), 201);
  })
  .patch("/:id/overrides/:resourceId", v("param", ResourceParamSchema), v("json", DateOverrideInputSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.overrides.update(venue.data.id, param.resourceId, c.req.valid("json")));
  })
  .delete("/:id/overrides/:resourceId", v("param", ResourceParamSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.overrides.delete(venue.data.id, param.resourceId));
  })
  .post("/:id/templates", v("param", VenueIdParamSchema), v("json", ShiftTemplateInputSchema), async (c) => {
    const venue = await adminVenue(c.req.valid("param").id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.templates.create(venue.data.id, c.req.valid("json")), 201);
  })
  .patch("/:id/templates/:resourceId", v("param", ResourceParamSchema), v("json", ShiftTemplateInputSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.templates.update(venue.data.id, param.resourceId, c.req.valid("json")));
  })
  .delete("/:id/templates/:resourceId", v("param", ResourceParamSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.templates.delete(venue.data.id, param.resourceId));
  })
  .post("/:id/templates/:templateId/signup", v("param", TemplateParamSchema), v("json", TemplateSignupInputSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await writeVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    if (venue.data.signupMode === "free") return respond(c, fail(err.badInput("Shift signup is disabled for this venue")));
    return respond(c, () => venueService.assignments.signupTemplate(venue.data, param.templateId, c.req.valid("json"), c.get("user")), 201);
  })
  .post("/:id/templates/:templateId/signup-weeks", v("param", TemplateParamSchema), v("json", TemplateWeeksInputSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await writeVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    if (venue.data.signupMode === "free") return respond(c, fail(err.badInput("Shift signup is disabled for this venue")));
    const body = c.req.valid("json");
    return respond(
      c,
      () => venueService.assignments.signupTemplateWeeks(venue.data, param.templateId, body.date, body.weeks, c.get("user")),
      201,
    );
  })
  .post("/:id/free-signup", v("param", VenueIdParamSchema), v("json", FreeSignupInputSchema), async (c) => {
    const venue = await writeVenue(c.req.valid("param").id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    if (venue.data.signupMode === "templates") return respond(c, fail(err.badInput("Free signup is disabled for this venue")));
    return respond(c, () => venueService.assignments.signupFree(venue.data.id, c.req.valid("json"), c.get("user")), 201);
  })
  .delete("/:id/assignments/:assignmentId", v("param", AssignmentParamSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await readVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    const canAdmin = hasAdminPermission(venue.data.permission);
    return respond(c, () => venueService.assignments.cancel(venue.data.id, param.assignmentId, c.get("user"), canAdmin));
  })
  .post("/:id/sections", v("param", VenueIdParamSchema), v("json", PublicSectionInputSchema), async (c) => {
    const venue = await adminVenue(c.req.valid("param").id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.sections.create(venue.data.id, c.req.valid("json")), 201);
  })
  .patch("/:id/sections/:resourceId", v("param", ResourceParamSchema), v("json", PublicSectionInputSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.sections.update(venue.data.id, param.resourceId, c.req.valid("json")));
  })
  .delete("/:id/sections/:resourceId", v("param", ResourceParamSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(param.id, c.get("user"));
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.sections.delete(venue.data.id, param.resourceId));
  });

const hasAdminPermission = (permission: PermissionLevel | undefined): boolean => permission === "admin";

const app = root
  .route("/widget", widgetRoutes)
  .route("/calendar", calendarRoutes)
  .route("/templates", venueTemplateRoutes)
  .route("/public", publicRoutes)
  .route("/venues", venueRoutes)
  .get(
    "/schema",
    describeRoute({
      tags: ["Meta"],
      summary: "Venue schemas",
      responses: {
        200: jsonResponse(
          z.object({
            venue: VenueSchema,
            dashboard: VenueDashboardSchema,
            slot: UpcomingSlotSchema,
            assignment: ShiftAssignmentSchema,
            feedback: FeedbackEntrySchema,
            access: AccessEntrySchema,
            message: MessageResponseSchema,
          }),
          "Schema references",
        ),
      },
    }),
    (c) => respond(c, ok({ message: "Venue API" })),
  );

export default app;
export type ApiType = typeof app;
