import { Hono } from "hono";
import { z } from "zod";
import { describeRoute } from "hono-openapi";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import {
  AccessEntrySchema,
  ErrorResponseSchema,
  GrantAccessSchema,
  PermissionLevelSchema,
} from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import { gateAt } from "./permissions";

const AccessListSchema = z.array(AccessEntrySchema);
const UpdateLevelSchema = z.object({ permission: PermissionLevelSchema });

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  // ── Base ACL ────────────────────────────────────────────────────────
  .get(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "List ACL entries for a base",
      responses: { 200: jsonResponse(AccessListSchema, "Entries") },
    }),
    async (c) => {
      const baseId = c.req.param("baseId");
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const entries = await gridsService.access.listForBase(baseId);
      return c.json(entries);
    },
  )
  .post(
    "/by-base/:baseId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Grant access on a base",
      responses: {
        201: jsonResponse(z.object({ accessId: z.string().uuid() }), "Created"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const baseId = c.req.param("baseId");
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(
        c,
        () => gridsService.access.grant({
          resourceType: "base",
          resourceId: baseId,
          ...c.req.valid("json"),
        }),
        201,
      );
    },
  )

  // ── Table ACL ───────────────────────────────────────────────────────
  .get(
    "/by-table/:tableId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "List ACL entries for a table",
      responses: { 200: jsonResponse(AccessListSchema, "Entries") },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const entries = await gridsService.access.listForTable(tableId);
      return c.json(entries);
    },
  )
  .post(
    "/by-table/:tableId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Grant access on a table",
      responses: { 201: jsonResponse(z.object({ accessId: z.string().uuid() }), "Created") },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(
        c,
        () => gridsService.access.grant({
          resourceType: "table",
          resourceId: tableId,
          ...c.req.valid("json"),
        }),
        201,
      );
    },
  )

  // ── View ACL ────────────────────────────────────────────────────────
  // View ACL only allows read at write-time (enforced here): write/admin
  // authority lives at table+ in the design.
  .post(
    "/by-view/:viewId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Grant read access on a view (only level 'read' is accepted)",
      responses: {
        201: jsonResponse(z.object({ accessId: z.string().uuid() }), "Created"),
        400: jsonResponse(ErrorResponseSchema, "View only accepts level 'read'"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const viewId = c.req.param("viewId");
      const body = c.req.valid("json");
      if (body.permission !== "read" && body.permission !== "none") {
        return c.json({ message: "View ACL only accepts 'read' or 'none'" }, 400);
      }
      // Note: full view-permission gating is deferred to when views are part
      // of Phase 2; for now the route exists so the contract is settled.
      return respond(
        c,
        () => gridsService.access.grant({
          resourceType: "view",
          resourceId: viewId,
          ...body,
        }),
        201,
      );
    },
  )

  // ── Modify / revoke a single grant by accessId ──────────────────────
  .patch(
    "/:accessId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Update a grant's permission level",
      responses: { 200: { description: "OK" } },
    }),
    v("json", UpdateLevelSchema),
    async (c) => {
      const accessId = c.req.param("accessId");
      // Revoking would need to know which resource the grant is bound to;
      // this route is intentionally minimal — caller supplies accessId
      // returned from a prior list/grant call. Trust + audit on update is
      // covered by the underlying services.
      const result = await gridsService.access.updateLevel(accessId, c.req.valid("json").permission);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )
  .delete(
    "/:accessId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Revoke a grant",
      responses: { 204: { description: "Revoked" } },
    }),
    async (c) => {
      const accessId = c.req.param("accessId");
      const result = await gridsService.access.revoke(accessId);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  );

export default app;
