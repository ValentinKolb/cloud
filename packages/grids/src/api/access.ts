import { AccessEntrySchema, ErrorResponseSchema, GrantAccessSchema, PermissionLevelSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { gridsService } from "../service";
import { currentActorUserId, gateAt } from "./permissions";

const AccessListSchema = z.array(AccessEntrySchema);
const UpdateLevelSchema = z.object({ permission: PermissionLevelSchema });

export const validateAccessLevelForResource = (resourceType: string, permission: string): string | null => {
  if (resourceType === "table" && permission === "admin") return "Table grants only accept 'read' / 'write' / 'none'";
  if (resourceType === "view" && permission !== "read" && permission !== "admin" && permission !== "none") {
    return "View grants only accept 'read', 'admin', or 'none'";
  }
  if (resourceType === "form" && permission !== "write" && permission !== "none") return "Form grants only accept 'write' or 'none'";
  if (
    resourceType === "documentTemplate" &&
    permission !== "read" &&
    permission !== "write" &&
    permission !== "admin" &&
    permission !== "none"
  ) {
    return "Document template grants only accept 'read', 'write', 'admin', or 'none'";
  }
  if (resourceType === "dashboard" && permission !== "read" && permission !== "none") {
    return "Dashboard grants only accept 'read' or 'none'";
  }
  if (resourceType === "workflow" && permission !== "read" && permission !== "write" && permission !== "admin" && permission !== "none") {
    return "Workflow grants only accept 'read', 'write', 'admin', or 'none'";
  }
  return null;
};

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
      return respond(
        c,
        () =>
          gridsService.access.grant({
            resourceType: "base",
            resourceId: baseId,
            actorId: currentActorUserId(c),
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
      // Tables only carry read/write/none — structural ops such as field CRUD,
      // table delete, ACL management, and form CRUD live at base-admin.
      if (body.permission === "admin") {
        return c.json({ message: "Table grants only accept 'read' / 'write' / 'none'" }, 400);
      }
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(
        c,
        () =>
          gridsService.access.grant({
            resourceType: "table",
            resourceId: tableId,
            actorId: currentActorUserId(c),
            ...body,
          }),
        201,
      );
    },
  )

  // ── View ACL ────────────────────────────────────────────────────────
  // View ACL grants read/admin/none at write-time (enforced on POST). Both
  // routes gate at base-admin — without this gate, any user could plant `none`
  // grants that shadow table/base permissions on views they don't own.
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
      return respond(
        c,
        () =>
          gridsService.access.grant({
            resourceType: "view",
            resourceId: viewId,
            actorId: currentActorUserId(c),
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
  // by being granted any form access; `admin` (= edit form config) lives at
  // base-admin and would conflict if duplicated here. Caller must be base-admin
  // — same reasoning as views.
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
      return respond(
        c,
        () =>
          gridsService.access.grant({
            resourceType: "form",
            resourceId: formId,
            actorId: currentActorUserId(c),
            ...body,
          }),
        201,
      );
    },
  )

  // ── Document template ACL ───────────────────────────────────────────
  // Document templates can be used from the workspace sidebar even when
  // the caller cannot browse the backing table. read = inspect/redownload
  // generated documents, write = generate/update operational document
  // metadata, admin = edit/delete/share the template, none = explicit deny.
  .get(
    "/by-document-template/:templateId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "List ACL entries for a document template",
      responses: {
        200: jsonResponse(AccessListSchema, "Entries"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Document template not found"),
      },
    }),
    async (c) => {
      const templateId = c.req.param("templateId")!;
      const [templateRow] = await sql<{ table_id: string; base_id: string }[]>`
        SELECT dt.table_id, t.base_id
        FROM grids.document_templates dt
        JOIN grids.tables t ON t.id = dt.table_id
        WHERE dt.id = ${templateId}::uuid AND dt.deleted_at IS NULL
      `;
      if (!templateRow) return c.json({ message: "Document template not found" }, 404);
      const gate = await gateAt(c, { baseId: templateRow.base_id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const entries = await gridsService.access.listForDocumentTemplate(templateId);
      return c.json(entries);
    },
  )
  .post(
    "/by-document-template/:templateId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Grant access on a document template (read / write / admin / none)",
      responses: {
        201: jsonResponse(z.object({ accessId: z.string().uuid() }), "Created"),
        400: jsonResponse(ErrorResponseSchema, "Document template only accepts level 'read', 'write', 'admin', or 'none'"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const templateId = c.req.param("templateId")!;
      const body = c.req.valid("json");
      if (body.permission !== "read" && body.permission !== "write" && body.permission !== "admin" && body.permission !== "none") {
        return c.json({ message: "Document template ACL only accepts 'read', 'write', 'admin', or 'none'" }, 400);
      }
      const [templateRow] = await sql<{ table_id: string; base_id: string }[]>`
        SELECT dt.table_id, t.base_id
        FROM grids.document_templates dt
        JOIN grids.tables t ON t.id = dt.table_id
        WHERE dt.id = ${templateId}::uuid AND dt.deleted_at IS NULL
      `;
      if (!templateRow) return c.json({ message: "Document template not found" }, 404);
      const gate = await gateAt(c, { baseId: templateRow.base_id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(
        c,
        () =>
          gridsService.access.grant({
            resourceType: "documentTemplate",
            resourceId: templateId,
            actorId: currentActorUserId(c),
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
      return respond(
        c,
        () =>
          gridsService.access.grant({
            resourceType: "dashboard",
            resourceId: dashboardId,
            actorId: currentActorUserId(c),
            ...body,
          }),
        201,
      );
    },
  )

  // ── Workflow ACL ───────────────────────────────────────────────────
  // Workflow grants use the standard operational levels:
  // read = inspect/list/run history, write = run operational workflows,
  // admin = edit YAML/access/delete. Exact endpoint gates live in the
  // workflow API; ACL mutations are still base-admin actions.
  .get(
    "/by-workflow/:workflowId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "List ACL entries for a workflow",
      responses: {
        200: jsonResponse(AccessListSchema, "Entries"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        404: jsonResponse(ErrorResponseSchema, "Workflow not found"),
      },
    }),
    async (c) => {
      const workflowId = c.req.param("workflowId")!;
      const workflow = await gridsService.workflow.get(workflowId);
      if (!workflow) return c.json({ message: "Workflow not found" }, 404);
      const gate = await gateAt(c, { baseId: workflow.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const entries = await gridsService.access.listForWorkflow(workflowId);
      return c.json(entries);
    },
  )
  .post(
    "/by-workflow/:workflowId",
    describeRoute({
      tags: ["Grids:Access"],
      summary: "Grant access on a workflow (read / write / admin / none)",
      responses: {
        201: jsonResponse(z.object({ accessId: z.string().uuid() }), "Created"),
        400: jsonResponse(ErrorResponseSchema, "Workflow only accepts level 'read', 'write', 'admin', or 'none'"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const workflowId = c.req.param("workflowId")!;
      const workflow = await gridsService.workflow.get(workflowId);
      if (!workflow) return c.json({ message: "Workflow not found" }, 404);
      const body = c.req.valid("json");
      const validationError = validateAccessLevelForResource("workflow", body.permission);
      if (validationError) return c.json({ message: validationError }, 400);
      const gate = await gateAt(c, { baseId: workflow.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(
        c,
        () =>
          gridsService.access.grant({
            resourceType: "workflow",
            resourceId: workflowId,
            actorId: currentActorUserId(c),
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
      const validationError = validateAccessLevelForResource(binding.resourceType, permission);
      if (validationError) return c.json({ message: validationError }, 400);

      const result = await gridsService.access.updateLevel(accessId, permission, currentActorUserId(c));
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

      const result = await gridsService.access.revoke(accessId, currentActorUserId(c));
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  );

export default app;
