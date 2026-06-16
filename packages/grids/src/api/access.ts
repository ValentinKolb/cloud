import { AccessEntrySchema, ErrorResponseSchema, GrantAccessSchema, PermissionLevelSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
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
      const baseId = c.req.param("baseId")!;
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
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(
        c,
        () =>
          gridsService.access.grant({
            resourceType: "base",
            resourceId: baseId,
            actorId: user.id,
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
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const entries = await gridsService.access.listForTable(tableId);
      return c.json(entries);
    },
  )
  .post(
    "/by-table/:tableId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Grant access on a table (only 'read' / 'write' / 'none' accepted)",
      responses: {
        201: jsonResponse(z.object({ accessId: z.string().uuid() }), "Created"),
        400: jsonResponse(ErrorResponseSchema, "Table only accepts level 'read' / 'write' / 'none'"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const body = c.req.valid("json");
      // Tables only carry read/write/none — the structural ops that
      // table-admin used to authorise (field CRUD, table delete, ACL
      // management, form CRUD) all moved to base-admin in the
      // permission simplification.
      if (body.permission === "admin") {
        return c.json({ message: "Table grants only accept 'read' / 'write' / 'none'" }, 400);
      }
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(
        c,
        () =>
          gridsService.access.grant({
            resourceType: "table",
            resourceId: tableId,
            actorId: user.id,
            ...body,
          }),
        201,
      );
    },
  )

  // ── View ACL ────────────────────────────────────────────────────────
  // View ACL only grants read at write-time (enforced on POST). Both
  // routes gate at admin on the view's parent table/base — without
  // this gate, any user could plant `none` grants that shadow table/
  // base permissions on views they don't own.
  .get(
    "/by-view/:viewId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "List ACL entries for a view",
      responses: {
        200: jsonResponse(AccessListSchema, "Entries"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "View not found"),
      },
    }),
    async (c) => {
      const viewId = c.req.param("viewId")!;
      const [viewRow] = await sql<{ table_id: string; base_id: string }[]>`
        SELECT v.table_id, t.base_id
        FROM grids.views v
        JOIN grids.tables t ON t.id = v.table_id
        WHERE v.id = ${viewId}::uuid
      `;
      if (!viewRow) return c.json({ message: "View not found" }, 404);
      const gate = await gateAt(c, { baseId: viewRow.base_id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const entries = await gridsService.access.listForView(viewId);
      return c.json(entries);
    },
  )
  .post(
    "/by-view/:viewId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Grant access on a view (only 'read' / 'admin' / 'none' accepted)",
      responses: {
        201: jsonResponse(z.object({ accessId: z.string().uuid() }), "Created"),
        400: jsonResponse(ErrorResponseSchema, "View only accepts level 'read', 'admin', or 'none'"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const viewId = c.req.param("viewId")!;
      const body = c.req.valid("json");
      if (body.permission !== "read" && body.permission !== "admin" && body.permission !== "none") {
        return c.json({ message: "View ACL only accepts 'read', 'admin', or 'none'" }, 400);
      }
      // Resolve view → table → base for the gate.
      const [viewRow] = await sql<{ table_id: string; base_id: string }[]>`
        SELECT v.table_id, t.base_id
        FROM grids.views v
        JOIN grids.tables t ON t.id = v.table_id
        WHERE v.id = ${viewId}::uuid
      `;
      if (!viewRow) return c.json({ message: "View not found" }, 404);
      const gate = await gateAt(c, { baseId: viewRow.base_id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(
        c,
        () =>
          gridsService.access.grant({
            resourceType: "view",
            resourceId: viewId,
            actorId: user.id,
            ...body,
          }),
        201,
      );
    },
  )

  // ── Form ACL ────────────────────────────────────────────────────────
  // Form ACLs only carry `write` (= "can submit this form even when it
  // has no public token"). read/admin are rejected at write-time:
  // `read` would just be "can render the form schema", which is implied
  // by being granted any form access; `admin` (= edit form config)
  // lives at table-admin and would conflict if duplicated here. Caller
  // must be admin on the form's parent table — same reasoning as views.
  .get(
    "/by-form/:formId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "List ACL entries for a form",
      responses: {
        200: jsonResponse(AccessListSchema, "Entries"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Form not found"),
      },
    }),
    async (c) => {
      const formId = c.req.param("formId")!;
      const [formRow] = await sql<{ table_id: string; base_id: string }[]>`
        SELECT f.table_id, t.base_id
        FROM grids.forms f
        JOIN grids.tables t ON t.id = f.table_id
        WHERE f.id = ${formId}::uuid
      `;
      if (!formRow) return c.json({ message: "Form not found" }, 404);
      const gate = await gateAt(c, { baseId: formRow.base_id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const entries = await gridsService.access.listForForm(formId);
      return c.json(entries);
    },
  )
  .post(
    "/by-form/:formId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Grant write access on a form (only 'write' / 'none' accepted)",
      responses: {
        201: jsonResponse(z.object({ accessId: z.string().uuid() }), "Created"),
        400: jsonResponse(ErrorResponseSchema, "Form only accepts level 'write' or 'none'"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const formId = c.req.param("formId")!;
      const body = c.req.valid("json");
      if (body.permission !== "write" && body.permission !== "none") {
        return c.json({ message: "Form ACL only accepts 'write' or 'none'" }, 400);
      }
      const [formRow] = await sql<{ table_id: string; base_id: string }[]>`
        SELECT f.table_id, t.base_id
        FROM grids.forms f
        JOIN grids.tables t ON t.id = f.table_id
        WHERE f.id = ${formId}::uuid
      `;
      if (!formRow) return c.json({ message: "Form not found" }, 404);
      const gate = await gateAt(c, { baseId: formRow.base_id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(
        c,
        () =>
          gridsService.access.grant({
            resourceType: "form",
            resourceId: formId,
            actorId: user.id,
            ...body,
          }),
        201,
      );
    },
  )

  // ── Dashboard ACL ───────────────────────────────────────────────────
  // Same shape as views: only `read` / `none` accepted. Caller must be
  // admin on the dashboard's parent base — without this gate, any user
  // could plant `none` grants that hide a shared dashboard from a
  // legitimate viewer.
  .get(
    "/by-dashboard/:dashboardId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "List ACL entries for a dashboard",
      responses: {
        200: jsonResponse(AccessListSchema, "Entries"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Dashboard not found"),
      },
    }),
    async (c) => {
      const dashboardId = c.req.param("dashboardId")!;
      const [row] = await sql<{ base_id: string }[]>`
        SELECT base_id FROM grids.dashboards WHERE id = ${dashboardId}::uuid
      `;
      if (!row) return c.json({ message: "Dashboard not found" }, 404);
      const gate = await gateAt(c, { baseId: row.base_id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const entries = await gridsService.access.listForDashboard(dashboardId);
      return c.json(entries);
    },
  )
  .post(
    "/by-dashboard/:dashboardId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Grant read access on a dashboard (only 'read' / 'none' accepted)",
      responses: {
        201: jsonResponse(z.object({ accessId: z.string().uuid() }), "Created"),
        400: jsonResponse(ErrorResponseSchema, "Dashboard only accepts 'read' or 'none'"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const dashboardId = c.req.param("dashboardId")!;
      const body = c.req.valid("json");
      if (body.permission !== "read" && body.permission !== "none") {
        return c.json({ message: "Dashboard ACL only accepts 'read' or 'none'" }, 400);
      }
      const [row] = await sql<{ base_id: string }[]>`
        SELECT base_id FROM grids.dashboards WHERE id = ${dashboardId}::uuid
      `;
      if (!row) return c.json({ message: "Dashboard not found" }, 404);
      const gate = await gateAt(c, { baseId: row.base_id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(
        c,
        () =>
          gridsService.access.grant({
            resourceType: "dashboard",
            resourceId: dashboardId,
            actorId: user.id,
            ...body,
          }),
        201,
      );
    },
  )

  // ── Modify / revoke a single grant by accessId ──────────────────────
  // Both routes resolve the access-id to its bound grids resource first,
  // then gate at admin on the parent. Without this lookup any authenticated
  // user with a known UUID could mutate another resource's ACL.
  .patch(
    "/:accessId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Update a grant's permission level",
      responses: {
        204: { description: "OK" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", UpdateLevelSchema),
    async (c) => {
      const accessId = c.req.param("accessId")!;
      const binding = await gridsService.access.resolveBinding(accessId);
      if (!binding) return c.json({ message: "Access entry not found" }, 404);

      // ACL management on any grids resource (base/table/view/form)
      // is a base-admin action — there's no per-table admin level any
      // more, so granting/revoking always gates at the base level.
      const gate = await gateAt(c, { baseId: binding.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const { permission } = c.req.valid("json");
      // Tables only carry read/write/none — admin was removed in the
      // permission simplification (structural ops moved to base-admin).
      if (binding.resourceType === "table" && permission === "admin") {
        return c.json({ message: "Table grants only accept 'read' / 'write' / 'none'" }, 400);
      }
      // View grants expose only read/admin/none. There is no view-write
      // level: editing a view definition is an admin action.
      if (binding.resourceType === "view" && permission !== "read" && permission !== "admin" && permission !== "none") {
        return c.json({ message: "View grants only accept 'read', 'admin', or 'none'" }, 400);
      }
      // Same enforcement for forms: write-or-none only.
      if (binding.resourceType === "form" && permission !== "write" && permission !== "none") {
        return c.json({ message: "Form grants only accept 'write' or 'none'" }, 400);
      }
      // Dashboards mirror views: read-or-none.
      if (binding.resourceType === "dashboard" && permission !== "read" && permission !== "none") {
        return c.json({ message: "Dashboard grants only accept 'read' or 'none'" }, 400);
      }

      const user = c.get("user");
      const result = await gridsService.access.updateLevel(accessId, permission, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )
  .delete(
    "/:accessId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Revoke a grant",
      responses: {
        204: { description: "Revoked" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const accessId = c.req.param("accessId")!;
      const binding = await gridsService.access.resolveBinding(accessId);
      if (!binding) return c.json({ message: "Access entry not found" }, 404);

      // Same as PATCH above — ACL revoke always gates at base-admin.
      const gate = await gateAt(c, { baseId: binding.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const user = c.get("user");
      const result = await gridsService.access.revoke(accessId, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  );

export default app;
