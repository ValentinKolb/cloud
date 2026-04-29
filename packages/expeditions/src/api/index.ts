import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  v,
  jsonResponse,
  requiresAuth,
  auth,
  type AuthContext,
  rateLimit,
  respond,
  updateAccess,
} from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import {
  AccessEntrySchema,
  GrantAccessSchema,
  UpdateAccessSchema,
  hasRole,
  type MutationResult,
  type PermissionLevel,
} from "@valentinkolb/cloud/contracts";
import { expeditionsService } from "../service";
import {
  ExpeditionSchema,
  WaypointSchema,
  CreateExpeditionSchema,
  UpdateExpeditionSchema,
  CreateWaypointSchema,
  SetWaypointDoneSchema,
  ErrorResponseSchema,
  MessageResponseSchema,
} from "@/contracts";

/**
 * HTTP API for the expeditions app.
 *
 * Mounted at `/api/expeditions` by `index.ts`. Every route is wrapped
 * by `auth.requireRole("user")` (sets up `c.get("user")`) and uses the
 * platform's `respond()` helper to convert `Result<T>` and `MutationResult<T>`
 * into HTTP responses (200 / 4xx with a structured error body).
 *
 * Access control flows through `checkExpeditionAccess()` — admins bypass,
 * everyone else needs the requested permission level on the resource.
 *
 * Each route is wrapped in `describeRoute()` so the OpenAPI doc at
 * `/api/_openapi` stays accurate.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

const ExpeditionListSchema = z.array(ExpeditionSchema);
const WaypointListSchema = z.array(WaypointSchema);
const AccessEntryListSchema = z.array(AccessEntrySchema);

/**
 * Resolve + access-check an expedition for a request. Returns either the
 * expedition + the user's permission level, or an `error` Response that the
 * caller forwards. Admins always pass.
 */
const checkExpeditionAccess = async (
  c: Context<AuthContext>,
  expeditionId: string,
  requiredLevel: PermissionLevel = "read",
) => {
  const user = c.get("user");
  const expedition = await expeditionsService.expedition.get({ id: expeditionId });

  if (!expedition) {
    return {
      expedition: null,
      permission: "none" as PermissionLevel,
      error: await respond(c, fail(err.notFound("Expedition"))),
    };
  }

  // Sysadmins bypass the per-resource ACL — they can manage any expedition.
  if (hasRole(user, "admin")) {
    return { expedition, permission: "admin" as PermissionLevel };
  }

  const allowed = await expeditionsService.expedition.permission.canAccess({
    expeditionId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    requiredLevel,
  });
  if (!allowed) {
    return {
      expedition: null,
      permission: "none" as PermissionLevel,
      error: await respond(c, fail(err.forbidden("Access denied"))),
    };
  }

  const permission = await expeditionsService.expedition.permission.get({
    expeditionId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });
  return { expedition, permission };
};

/** Wrap a `Result<void>`-shaped mutation in a `{ message }` JSON response. */
const respondMessage = async (
  c: Context,
  resultPromise: Promise<Result<void> | MutationResult<void>>,
  message: string,
) => {
  return respond(c, async () => {
    const result = await resultPromise;
    if (!result.ok) return result;
    return ok({ message });
  });
};

/** Cross-resource guard: ensure a waypoint belongs to the URL's expedition. */
const requireWaypointInExpedition = async (expeditionId: string, waypointId: string) => {
  const waypoint = await expeditionsService.waypoint.get({ id: waypointId });
  if (!waypoint || waypoint.expeditionId !== expeditionId) {
    return fail(err.notFound("Waypoint"));
  }
  return ok(waypoint);
};

// ── Routes ──────────────────────────────────────────────────────────────────
//
// Layout follows the platform's four-prefix scheme: this Hono is mounted at
// `/api/expeditions`, so its sub-routes become:
//   /api/expeditions/widget/*  — dashboard widget endpoints (own auth)
//   /api/expeditions/...       — CRUD endpoints (auth.requireRole("user"))
//
// Widget routes are mounted *before* the auth middleware so they keep their
// own permission gating (200/403) instead of inheriting a 401.

import widgetRoutes from "./widgets";

const app = new Hono<AuthContext>()
  .route("/widget", widgetRoutes)
  .use(rateLimit())
  .use(auth.requireRole("user"))

  // ── Expedition CRUD ──────────────────────────────────────────────────────

  .get(
    "/",
    describeRoute({
      tags: ["Expeditions"],
      summary: "List expeditions",
      description: "List all expeditions accessible to the current user.",
      ...requiresAuth,
      responses: { 200: jsonResponse(ExpeditionListSchema, "Accessible expeditions") },
    }),
    async (c) => {
      const user = c.get("user");
      const result = await expeditionsService.expedition.list({
        userId: user.id,
        groups: user.memberofGroupIds,
      });
      return respond(c, ok(result.items));
    },
  )

  .post(
    "/",
    describeRoute({
      tags: ["Expeditions"],
      summary: "Create expedition",
      description: "Create a new expedition. The creator is granted admin access automatically.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ExpeditionSchema, "Created expedition"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
      },
    }),
    v("json", CreateExpeditionSchema),
    async (c) => {
      const user = c.get("user");
      const data = c.req.valid("json");
      return respond(c, expeditionsService.expedition.create({ data, creatorId: user.id }));
    },
  )

  .get(
    "/:id",
    describeRoute({
      tags: ["Expeditions"],
      summary: "Get expedition",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ExpeditionSchema, "Expedition"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const { expedition, error } = await checkExpeditionAccess(c, id);
      if (error) return error;
      return respond(c, ok(expedition));
    },
  )

  .patch(
    "/:id",
    describeRoute({
      tags: ["Expeditions"],
      summary: "Update expedition",
      description: "Edit title, description, or icon. Requires write permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ExpeditionSchema, "Updated expedition"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", UpdateExpeditionSchema),
    async (c) => {
      const id = c.req.param("id");
      const data = c.req.valid("json");
      const { error } = await checkExpeditionAccess(c, id, "write");
      if (error) return error;
      return respond(c, expeditionsService.expedition.update({ id, data }));
    },
  )

  .delete(
    "/:id",
    describeRoute({
      tags: ["Expeditions"],
      summary: "Delete expedition",
      description: "Delete an expedition and all its waypoints. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Expedition deleted"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const { error } = await checkExpeditionAccess(c, id, "admin");
      if (error) return error;
      return respondMessage(c, expeditionsService.expedition.remove({ id }), "Expedition deleted");
    },
  )

  // ── Waypoints ────────────────────────────────────────────────────────────

  .get(
    "/:id/waypoints",
    describeRoute({
      tags: ["Expeditions"],
      summary: "List waypoints",
      ...requiresAuth,
      responses: {
        200: jsonResponse(WaypointListSchema, "Waypoints in display order"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const expeditionId = c.req.param("id");
      const { error } = await checkExpeditionAccess(c, expeditionId);
      if (error) return error;
      return respond(c, ok(await expeditionsService.waypoint.list({ expeditionId })));
    },
  )

  .post(
    "/:id/waypoints",
    describeRoute({
      tags: ["Expeditions"],
      summary: "Create waypoint",
      description: "Append a waypoint at the end. Requires write permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(WaypointSchema, "Created waypoint"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", CreateWaypointSchema),
    async (c) => {
      const expeditionId = c.req.param("id");
      const data = c.req.valid("json");
      const { error } = await checkExpeditionAccess(c, expeditionId, "write");
      if (error) return error;
      return respond(c, expeditionsService.waypoint.create({ expeditionId, data }));
    },
  )

  .patch(
    "/:id/waypoints/:waypointId",
    describeRoute({
      tags: ["Expeditions"],
      summary: "Toggle waypoint done",
      description: "Mark a waypoint done or re-open it. Triggers the completion email if the expedition is now fully done.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(WaypointSchema, "Updated waypoint"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", SetWaypointDoneSchema),
    async (c) => {
      const expeditionId = c.req.param("id");
      const waypointId = c.req.param("waypointId");
      const { done } = c.req.valid("json");
      const { error } = await checkExpeditionAccess(c, expeditionId, "write");
      if (error) return error;
      const guard = await requireWaypointInExpedition(expeditionId, waypointId);
      if (!guard.ok) return respond(c, guard);
      return respond(c, expeditionsService.waypoint.setDone({ id: waypointId, done }));
    },
  )

  .delete(
    "/:id/waypoints/:waypointId",
    describeRoute({
      tags: ["Expeditions"],
      summary: "Delete waypoint",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Waypoint deleted"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const expeditionId = c.req.param("id");
      const waypointId = c.req.param("waypointId");
      const { error } = await checkExpeditionAccess(c, expeditionId, "write");
      if (error) return error;
      const guard = await requireWaypointInExpedition(expeditionId, waypointId);
      if (!guard.ok) return respond(c, guard);
      return respondMessage(c, expeditionsService.waypoint.remove({ id: waypointId }), "Waypoint deleted");
    },
  )

  // ── Access (permission editor) ───────────────────────────────────────────

  .get(
    "/:id/access",
    describeRoute({
      tags: ["Expeditions"],
      summary: "List access entries",
      description: "Used by the PermissionEditor dialog. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(AccessEntryListSchema, "Access entries"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
      },
    }),
    async (c) => {
      const expeditionId = c.req.param("id");
      const { error } = await checkExpeditionAccess(c, expeditionId, "admin");
      if (error) return error;
      const result = await expeditionsService.access.list({ expeditionId });
      return respond(c, ok(result.items));
    },
  )

  .post(
    "/:id/access",
    describeRoute({
      tags: ["Expeditions"],
      summary: "Grant access",
      ...requiresAuth,
      responses: {
        200: jsonResponse(AccessEntrySchema, "Created access entry"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        409: jsonResponse(ErrorResponseSchema, "Principal already has access"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const expeditionId = c.req.param("id");
      const data = c.req.valid("json");
      const { error } = await checkExpeditionAccess(c, expeditionId, "admin");
      if (error) return error;
      return respond(
        c,
        expeditionsService.access.grant({
          expeditionId,
          principal: data.principal,
          permission: data.permission,
        }),
      );
    },
  )

  .patch(
    "/:id/access/:accessId",
    describeRoute({
      tags: ["Expeditions"],
      summary: "Update access permission",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Access updated"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
      },
    }),
    v("json", UpdateAccessSchema),
    async (c) => {
      const expeditionId = c.req.param("id");
      const accessId = c.req.param("accessId");
      const { permission } = c.req.valid("json");
      const { error } = await checkExpeditionAccess(c, expeditionId, "admin");
      if (error) return error;
      // `updateAccess` lives in the cloud lib — works against any resource.
      return respondMessage(c, updateAccess({ id: accessId, permission }), "Access updated");
    },
  )

  .delete(
    "/:id/access/:accessId",
    describeRoute({
      tags: ["Expeditions"],
      summary: "Revoke access",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Access revoked"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
      },
    }),
    async (c) => {
      const expeditionId = c.req.param("id");
      const accessId = c.req.param("accessId");
      const { error } = await checkExpeditionAccess(c, expeditionId, "admin");
      if (error) return error;
      return respondMessage(
        c,
        expeditionsService.access.remove({ expeditionId, accessId }),
        "Access revoked",
      );
    },
  );

export default app;

/** RPC type for the typed client (see ./client.ts). */
export type ApiType = typeof app;
