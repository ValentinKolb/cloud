import { Hono } from "hono";
import { sql } from "bun";
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
      const viewId = c.req.param("viewId");
      const [viewRow] = await sql<{ table_id: string; base_id: string }[]>`
        SELECT v.table_id, t.base_id
        FROM grids.views v
        JOIN grids.tables t ON t.id = v.table_id
        WHERE v.id = ${viewId}::uuid
      `;
      if (!viewRow) return c.json({ message: "View not found" }, 404);
      const gate = await gateAt(c, { baseId: viewRow.base_id, tableId: viewRow.table_id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const entries = await gridsService.access.listForView(viewId);
      return c.json(entries);
    },
  )
  .post(
    "/by-view/:viewId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Grant read access on a view (only 'read' / 'none' accepted)",
      responses: {
        201: jsonResponse(z.object({ accessId: z.string().uuid() }), "Created"),
        400: jsonResponse(ErrorResponseSchema, "View only accepts level 'read' or 'none'"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const viewId = c.req.param("viewId");
      const body = c.req.valid("json");
      if (body.permission !== "read" && body.permission !== "none") {
        return c.json({ message: "View ACL only accepts 'read' or 'none'" }, 400);
      }
      // Resolve view → table → base for the gate.
      const [viewRow] = await sql<{ table_id: string; base_id: string }[]>`
        SELECT v.table_id, t.base_id
        FROM grids.views v
        JOIN grids.tables t ON t.id = v.table_id
        WHERE v.id = ${viewId}::uuid
      `;
      if (!viewRow) return c.json({ message: "View not found" }, 404);
      const gate = await gateAt(c, { baseId: viewRow.base_id, tableId: viewRow.table_id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
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
      const formId = c.req.param("formId");
      const [formRow] = await sql<{ table_id: string; base_id: string }[]>`
        SELECT f.table_id, t.base_id
        FROM grids.forms f
        JOIN grids.tables t ON t.id = f.table_id
        WHERE f.id = ${formId}::uuid
      `;
      if (!formRow) return c.json({ message: "Form not found" }, 404);
      const gate = await gateAt(c, { baseId: formRow.base_id, tableId: formRow.table_id }, "admin");
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
      const formId = c.req.param("formId");
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
      const gate = await gateAt(c, { baseId: formRow.base_id, tableId: formRow.table_id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(
        c,
        () => gridsService.access.grant({
          resourceType: "form",
          resourceId: formId,
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
      const accessId = c.req.param("accessId");
      const binding = await gridsService.access.resolveBinding(accessId);
      if (!binding) return c.json({ message: "Access entry not found" }, 404);

      const target =
        binding.resourceType === "base"
          ? { baseId: binding.baseId }
          : binding.resourceType === "table"
            ? { baseId: binding.baseId, tableId: binding.tableId }
            : binding.resourceType === "view"
              ? { baseId: binding.baseId, tableId: binding.tableId, viewId: binding.viewId }
              : { baseId: binding.baseId, tableId: binding.tableId, formId: binding.formId };
      const gate = await gateAt(c, target, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const { permission } = c.req.valid("json");
      // View grants stay capped at read/none even on update — the resolver
      // never re-caps so we have to enforce on every write to the row.
      if (binding.resourceType === "view" && permission !== "read" && permission !== "none") {
        return c.json({ message: "View grants only accept 'read' or 'none'" }, 400);
      }
      // Same enforcement for forms: write-or-none only.
      if (binding.resourceType === "form" && permission !== "write" && permission !== "none") {
        return c.json({ message: "Form grants only accept 'write' or 'none'" }, 400);
      }

      const result = await gridsService.access.updateLevel(accessId, permission);
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
      const accessId = c.req.param("accessId");
      const binding = await gridsService.access.resolveBinding(accessId);
      if (!binding) return c.json({ message: "Access entry not found" }, 404);

      const target =
        binding.resourceType === "base"
          ? { baseId: binding.baseId }
          : binding.resourceType === "table"
            ? { baseId: binding.baseId, tableId: binding.tableId }
            : binding.resourceType === "view"
              ? { baseId: binding.baseId, tableId: binding.tableId, viewId: binding.viewId }
              : { baseId: binding.baseId, tableId: binding.tableId, formId: binding.formId };
      const gate = await gateAt(c, target, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      const result = await gridsService.access.revoke(accessId);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  );

export default app;
