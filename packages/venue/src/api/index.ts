import type { WidgetResponse } from "@valentinkolb/cloud/contracts";
import {
  AccessEntrySchema,
  ErrorResponseSchema,
  GrantAccessSchema,
  MessageResponseSchema,
  type PermissionLevel,
  ServiceAccountCredentialSchema,
  UpdateAccessSchema,
} from "@valentinkolb/cloud/contracts";
import {
  type AuthContext,
  auth,
  err,
  fail,
  hasPermission,
  jsonResponse,
  ok,
  rateLimit,
  respond,
  respondMessage,
  v,
} from "@valentinkolb/cloud/server";
import { coreSettings, serviceAccountCredentials, serviceAccounts } from "@valentinkolb/cloud/services";
import { type Context, Hono } from "hono";
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
const ApiKeyParamSchema = z.object({ id: z.string().uuid(), credentialId: z.string().uuid() });
const ResourceParamSchema = z.object({ id: z.string().uuid(), resourceId: z.string().uuid() });
const TemplateParamSchema = z.object({ id: z.string().uuid(), templateId: z.string().uuid() });
const AssignmentParamSchema = z.object({ id: z.string().uuid(), assignmentId: z.string().uuid() });
const PublicSlugParamSchema = z.object({ slug: z.string().min(1).max(80) });
const TokenParamSchema = z.object({ token: z.string().min(16).max(128) });
const VenueTemplateParamSchema = z.object({ templateId: z.string().min(1).max(80) });
const TemplateWeeksInputSchema = TemplateSignupInputSchema.extend({ weeks: z.number().int().min(1).max(12).default(4) });
const VenueApiKeySchema = ServiceAccountCredentialSchema.extend({
  permission: z.enum(["none", "read", "write", "admin"]),
});
const CreateVenueApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  expiresAt: z.string().datetime().nullable().optional(),
  permission: z.enum(["read", "write", "admin"]).default("read"),
});
const CreateVenueApiKeyResponseSchema = z.object({
  credential: VenueApiKeySchema,
  token: z.string(),
});

type VenueApiKey = z.infer<typeof VenueApiKeySchema>;
type UserBackedActor = AuthContext["Variables"]["user"];

const VENUE_APP_ID = "venue";
const VENUE_RESOURCE_TYPE = "venue";

const permissionFromScopes = (scopes: string[]): PermissionLevel => {
  if (scopes.includes("admin")) return "admin";
  if (scopes.includes("write")) return "write";
  if (scopes.includes("read")) return "read";
  return "none";
};

const getUserBackedActor = (c: Context<AuthContext>): UserBackedActor | null => {
  const actor = c.get("actor");
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

const requireUserBackedActor = (c: Context<AuthContext>) => {
  const user = getUserBackedActor(c);
  if (!user) return fail(err.forbidden("Venues require a user-backed actor for this action"));
  return ok(user);
};

const getVenueAccessSubject = (c: Context<AuthContext>, venueId?: string) => {
  const actor = c.get("actor");
  const accessSubject = c.get("accessSubject");
  const user = getUserBackedActor(c);

  if (actor.kind === "service_account" && actor.serviceAccount.kind === "resource_bound") {
    const serviceAccount = actor.serviceAccount;
    if (serviceAccount.appId !== VENUE_APP_ID || serviceAccount.resourceType !== VENUE_RESOURCE_TYPE || !serviceAccount.resourceId) {
      return fail(err.forbidden("Access denied"));
    }
    if (venueId && serviceAccount.resourceId !== venueId) {
      return fail(err.forbidden("Access denied"));
    }
    if (!hasPermission(permissionFromScopes(actor.scopes), "read")) {
      return fail(err.forbidden("Access denied"));
    }
  }

  return ok({
    user,
    subject: accessSubject,
    serviceAccountResourceId:
      actor.kind === "service_account" && actor.serviceAccount.kind === "resource_bound" ? actor.serviceAccount.resourceId : null,
    serviceAccountScopes: actor.kind === "service_account" && actor.serviceAccount.kind === "resource_bound" ? actor.scopes : [],
  });
};

const requireVenue = async (c: Context<AuthContext>, id: string, permission: PermissionLevel) => {
  const subject = getVenueAccessSubject(c, id);
  if (!subject.ok) return subject;
  const venue = await venueService.venues.get(id, subject.data);
  if (!venue) return fail(err.notFound("Venue"));
  const allowed = await venueService.access.require(id, subject.data, permission);
  if (!allowed.ok) return allowed;
  return ok(venue);
};

const readVenue = async (c: Context<AuthContext>, id: string) => requireVenue(c, id, "read");
const writeVenue = async (c: Context<AuthContext>, id: string) => requireVenue(c, id, "write");
const adminVenue = async (c: Context<AuthContext>, id: string) => requireVenue(c, id, "admin");

const listVenueApiKeys = async (venueId: string): Promise<VenueApiKey[]> => {
  const [keys, accessEntries] = await Promise.all([
    serviceAccountCredentials.listOverview({
      pagination: { page: 1, perPage: 500 },
      filter: {
        serviceAccountKind: "resource_bound",
        credentialStatus: "active",
        appId: VENUE_APP_ID,
        resourceType: VENUE_RESOURCE_TYPE,
        resourceId: venueId,
      },
    }),
    venueService.access.list(venueId),
  ]);

  const permissionByServiceAccountId = new Map(
    accessEntries
      .filter((entry) => entry.principal.type === "service_account")
      .map((entry) => [(entry.principal as { type: "service_account"; serviceAccountId: string }).serviceAccountId, entry.permission]),
  );

  return keys.items.map((item) => {
    const permission = permissionByServiceAccountId.get(item.serviceAccount.id) ?? "none";
    const { serviceAccount: _serviceAccount, owner: _owner, ...credential } = item;
    return { ...credential, permission };
  });
};

const root = new Hono<AuthContext>();
// biome-ignore format: check-service-api-contracts requires a leading `.use(...)` line before route handlers.
root
  .use(rateLimit());

const widgetRoutes = new Hono<AuthContext>().get("/today", auth.requireRole("authenticated"), async (c) => {
  const userResult = requireUserBackedActor(c);
  if (!userResult.ok) return c.body(null, 403);
  const user = userResult.data;
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
    const user = requireUserBackedActor(c);
    if (!user.ok) return respond(c, user);
    const token = await venueService.ical.getOrCreateToken(user.data.id);
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
    async (c) => {
      const user = requireUserBackedActor(c);
      if (!user.ok) return respond(c, user);
      return respond(
        c,
        () => venueService.venueTemplates.instantiate(c.req.valid("param").templateId, c.req.valid("json"), user.data),
        201,
      );
    },
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
      c.header("Cache-Control", "no-store");
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
      if (!venue || !venue.publicEnabled) return respond(c, fail(err.notFound("Venue")));
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
    async (c) => {
      const subject = getVenueAccessSubject(c);
      if (!subject.ok) return respond(c, subject);
      return respond(c, ok({ venues: await venueService.venues.list(subject.data) }));
    },
  )
  .post(
    "/",
    describeRoute({
      tags: ["Venues"],
      summary: "Create venue",
      responses: { 201: jsonResponse(VenueSchema, "Created venue"), 400: jsonResponse(ErrorResponseSchema, "Invalid venue") },
    }),
    v("json", VenueInputSchema),
    async (c) => {
      const user = requireUserBackedActor(c);
      if (!user.ok) return respond(c, user);
      return respond(c, () => venueService.venues.create(c.req.valid("json"), user.data), 201);
    },
  )
  .get("/:id/dashboard", v("param", VenueIdParamSchema), async (c) => {
    const venue = await readVenue(c, c.req.valid("param").id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, ok(await venueService.dashboard(venue.data, getUserBackedActor(c))));
  })
  .patch("/:id", v("param", VenueIdParamSchema), v("json", VenueInputSchema), async (c) => {
    const venue = await adminVenue(c, c.req.valid("param").id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.venues.update(venue.data.id, c.req.valid("json")));
  })
  .delete(
    "/:id",
    describeRoute({
      tags: ["Venues"],
      summary: "Delete venue",
      description: "Delete a venue and all venue-owned data. Requires admin permission.",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Venue deleted"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Venue not found"),
      },
    }),
    v("param", VenueIdParamSchema),
    async (c) => {
      const venue = await adminVenue(c, c.req.valid("param").id);
      if (!venue.ok) return respond(c, venue);
      return respondMessage(c, venueService.venues.delete(venue.data.id), "Venue deleted");
    },
  )
  .get("/:id/access", v("param", VenueIdParamSchema), async (c) => {
    const venue = await adminVenue(c, c.req.valid("param").id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, ok({ entries: await venueService.access.list(venue.data.id) }));
  })
  .post("/:id/access", v("param", VenueIdParamSchema), v("json", GrantAccessSchema), async (c) => {
    const venue = await adminVenue(c, c.req.valid("param").id);
    if (!venue.ok) return respond(c, venue);
    const body = c.req.valid("json");
    return respond(c, () => venueService.access.grant(venue.data.id, body.principal, body.permission), 201);
  })
  .patch("/:id/access/:accessId", v("param", AccessParamSchema), v("json", UpdateAccessSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(c, param.id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.access.update(venue.data.id, param.accessId, c.req.valid("json").permission));
  })
  .delete("/:id/access/:accessId", v("param", AccessParamSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(c, param.id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.access.revoke(venue.data.id, param.accessId));
  })
  .get(
    "/:id/api-keys",
    describeRoute({
      tags: ["Venues"],
      summary: "List venue API keys",
      responses: {
        200: jsonResponse(z.object({ items: z.array(VenueApiKeySchema) }), "Venue API keys"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Venue not found"),
      },
    }),
    v("param", VenueIdParamSchema),
    async (c) => {
      const venue = await adminVenue(c, c.req.valid("param").id);
      if (!venue.ok) return respond(c, venue);
      return respond(c, ok({ items: await listVenueApiKeys(venue.data.id) }));
    },
  )
  .post(
    "/:id/api-keys",
    describeRoute({
      tags: ["Venues"],
      summary: "Create venue API key",
      description: "Create a resource-bound API key for this venue. The raw token is returned once. Requires admin permission.",
      responses: {
        201: jsonResponse(CreateVenueApiKeyResponseSchema, "Venue API key created"),
        400: jsonResponse(ErrorResponseSchema, "Failed to create API key"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Venue not found"),
      },
    }),
    v("param", VenueIdParamSchema),
    v("json", CreateVenueApiKeySchema),
    async (c) => {
      const user = requireUserBackedActor(c);
      if (!user.ok) return respond(c, user);
      const venue = await adminVenue(c, c.req.valid("param").id);
      if (!venue.ok) return respond(c, venue);
      const data = c.req.valid("json");

      return respond(
        c,
        async () => {
          const serviceAccount = await serviceAccounts.createResourceBound({
            name: `${venue.data.name} API key: ${data.name}`,
            appId: VENUE_APP_ID,
            resourceType: VENUE_RESOURCE_TYPE,
            resourceId: venue.data.id,
            createdBy: user.data.id,
          });
          if (!serviceAccount.ok) return serviceAccount;

          const cleanupServiceAccount = async () => {
            await serviceAccounts.delete({ id: serviceAccount.data.id });
          };

          const access = await venueService.access.grant(
            venue.data.id,
            { type: "service_account", serviceAccountId: serviceAccount.data.id },
            data.permission,
          );
          if (!access.ok) {
            await cleanupServiceAccount();
            return access;
          }

          const created = await serviceAccountCredentials.createResourceApiToken({
            serviceAccountId: serviceAccount.data.id,
            actor: user.data,
            name: data.name,
            expiresAt: data.expiresAt ?? null,
            scopes: [data.permission],
          });
          if (!created.ok) {
            await cleanupServiceAccount();
            return created;
          }

          return ok({
            credential: {
              ...created.data.credential,
              permission: access.data.permission,
            },
            token: created.data.token,
          });
        },
        201,
      );
    },
  )
  .delete(
    "/:id/api-keys/:credentialId",
    describeRoute({
      tags: ["Venues"],
      summary: "Revoke venue API key",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Venue API key revoked"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "API key not found"),
      },
    }),
    v("param", ApiKeyParamSchema),
    async (c) => {
      const user = requireUserBackedActor(c);
      if (!user.ok) return respond(c, user);
      const param = c.req.valid("param");
      const venue = await adminVenue(c, param.id);
      if (!venue.ok) return respond(c, venue);

      return respond(c, async () => {
        const keys = await listVenueApiKeys(venue.data.id);
        if (!keys.some((key) => key.id === param.credentialId)) return fail(err.notFound("API key"));
        const revoked = await serviceAccountCredentials.revoke({ credentialId: param.credentialId, actor: user.data });
        if (!revoked.ok) return revoked;
        return ok({ message: "API key revoked." });
      });
    },
  )
  .post("/:id/opening-rules", v("param", VenueIdParamSchema), v("json", OpeningRuleInputSchema), async (c) => {
    const venue = await adminVenue(c, c.req.valid("param").id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.openingRules.create(venue.data.id, c.req.valid("json")), 201);
  })
  .patch("/:id/opening-rules/:resourceId", v("param", ResourceParamSchema), v("json", OpeningRuleInputSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(c, param.id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.openingRules.update(venue.data.id, param.resourceId, c.req.valid("json")));
  })
  .delete("/:id/opening-rules/:resourceId", v("param", ResourceParamSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(c, param.id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.openingRules.delete(venue.data.id, param.resourceId));
  })
  .post("/:id/overrides", v("param", VenueIdParamSchema), v("json", DateOverrideInputSchema), async (c) => {
    const venue = await adminVenue(c, c.req.valid("param").id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.overrides.upsert(venue.data.id, c.req.valid("json")), 201);
  })
  .patch("/:id/overrides/:resourceId", v("param", ResourceParamSchema), v("json", DateOverrideInputSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(c, param.id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.overrides.update(venue.data.id, param.resourceId, c.req.valid("json")));
  })
  .delete("/:id/overrides/:resourceId", v("param", ResourceParamSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(c, param.id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.overrides.delete(venue.data.id, param.resourceId));
  })
  .post("/:id/templates", v("param", VenueIdParamSchema), v("json", ShiftTemplateInputSchema), async (c) => {
    const venue = await adminVenue(c, c.req.valid("param").id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.templates.create(venue.data.id, c.req.valid("json")), 201);
  })
  .patch("/:id/templates/:resourceId", v("param", ResourceParamSchema), v("json", ShiftTemplateInputSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(c, param.id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.templates.update(venue.data.id, param.resourceId, c.req.valid("json")));
  })
  .delete("/:id/templates/:resourceId", v("param", ResourceParamSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(c, param.id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.templates.delete(venue.data.id, param.resourceId));
  })
  .post("/:id/templates/:templateId/signup", v("param", TemplateParamSchema), v("json", TemplateSignupInputSchema), async (c) => {
    const user = requireUserBackedActor(c);
    if (!user.ok) return respond(c, user);
    const param = c.req.valid("param");
    const venue = await writeVenue(c, param.id);
    if (!venue.ok) return respond(c, venue);
    if (venue.data.signupMode === "free") return respond(c, fail(err.badInput("Shift signup is disabled for this venue")));
    return respond(c, () => venueService.assignments.signupTemplate(venue.data, param.templateId, c.req.valid("json"), user.data), 201);
  })
  .post("/:id/templates/:templateId/signup-weeks", v("param", TemplateParamSchema), v("json", TemplateWeeksInputSchema), async (c) => {
    const user = requireUserBackedActor(c);
    if (!user.ok) return respond(c, user);
    const param = c.req.valid("param");
    const venue = await writeVenue(c, param.id);
    if (!venue.ok) return respond(c, venue);
    if (venue.data.signupMode === "free") return respond(c, fail(err.badInput("Shift signup is disabled for this venue")));
    const body = c.req.valid("json");
    return respond(
      c,
      () => venueService.assignments.signupTemplateWeeks(venue.data, param.templateId, body.date, body.weeks, user.data),
      201,
    );
  })
  .post("/:id/free-signup", v("param", VenueIdParamSchema), v("json", FreeSignupInputSchema), async (c) => {
    const user = requireUserBackedActor(c);
    if (!user.ok) return respond(c, user);
    const venue = await writeVenue(c, c.req.valid("param").id);
    if (!venue.ok) return respond(c, venue);
    if (venue.data.signupMode === "templates") return respond(c, fail(err.badInput("Free signup is disabled for this venue")));
    return respond(c, () => venueService.assignments.signupFree(venue.data.id, c.req.valid("json"), user.data), 201);
  })
  .delete("/:id/assignments/:assignmentId", v("param", AssignmentParamSchema), async (c) => {
    const user = requireUserBackedActor(c);
    if (!user.ok) return respond(c, user);
    const param = c.req.valid("param");
    const venue = await readVenue(c, param.id);
    if (!venue.ok) return respond(c, venue);
    const canAdmin = hasAdminPermission(venue.data.permission);
    return respond(c, () => venueService.assignments.cancel(venue.data.id, param.assignmentId, user.data, canAdmin));
  })
  .post("/:id/sections", v("param", VenueIdParamSchema), v("json", PublicSectionInputSchema), async (c) => {
    const venue = await adminVenue(c, c.req.valid("param").id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.sections.create(venue.data.id, c.req.valid("json")), 201);
  })
  .patch("/:id/sections/:resourceId", v("param", ResourceParamSchema), v("json", PublicSectionInputSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(c, param.id);
    if (!venue.ok) return respond(c, venue);
    return respond(c, () => venueService.sections.update(venue.data.id, param.resourceId, c.req.valid("json")));
  })
  .delete("/:id/sections/:resourceId", v("param", ResourceParamSchema), async (c) => {
    const param = c.req.valid("param");
    const venue = await adminVenue(c, param.id);
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
