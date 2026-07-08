import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { CreateViewSchema, UpdateViewSchema, ViewListSchema, ViewSchema } from "../contracts";
import { gridsService } from "../service";
import { compileGqlViewWrite } from "./gql-runtime";
import { currentActorUser, currentActorUserId, currentActorViewer, gateAt, hasExplicitGrant, resolveWithGrants } from "./permissions";

const gqlDiagnosticMessage = (diagnostics: Array<{ message: string }>): string =>
  diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "invalid GQL source";

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/by-table/:tableId",
    describeRoute({
      tags: ["Grids:View"],
      summary: "List views visible on a table",
      responses: { 200: jsonResponse(ViewListSchema, "Views") },
    }),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const list = await gridsService.view.listForTable({
        tableId,
        ...currentActorViewer(c),
      });
      return c.json(list);
    },
  )

  .post(
    "/by-table/:tableId",
    describeRoute({
      tags: ["Grids:View"],
      summary: "Create a view (shared or personal)",
      responses: {
        201: jsonResponse(ViewSchema, "Created"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", CreateViewSchema),
    async (c) => {
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      // Personal views: any table-reader can save their own preset.
      // Shared views: structural change to the table's catalog → only
      // base-admin can publish them. Mirrors the rule that all other
      // structural ops on a base (fields, forms, ACLs) live at
      // base-admin.
      const body = c.req.valid("json");
      const gate = body.shared
        ? await gateAt(c, { baseId: table.baseId }, "admin")
        : await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const compiled = await compileGqlViewWrite(c, {
        baseId: table.baseId,
        tableId,
        ...(body.source !== undefined ? { source: body.source } : {}),
      });
      if (!compiled.ok) return c.json({ message: gqlDiagnosticMessage(compiled.diagnostics) }, 400);
      const user = currentActorUser(c);
      if (!body.shared && !user) return c.json({ message: "Sign in to create a personal view." }, 403);
      return respond(
        c,
        () =>
          gridsService.view.create(
            {
              tableId,
              name: body.name,
              description: body.description ?? null,
              icon: body.icon ?? null,
              source: compiled.source,
              ui: body.ui,
              ownerUserId: body.shared ? null : (user?.id ?? null),
            },
            currentActorUserId(c),
          ),
        201,
      );
    },
  )

  .get(
    "/:viewId",
    describeRoute({
      tags: ["Grids:View"],
      summary: "Get a single view",
      responses: {
        200: jsonResponse(ViewSchema, "View"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const viewId = c.req.param("viewId")!;
      const view = await gridsService.view.get(viewId);
      if (!view) return c.json({ message: "View not found" }, 404);
      const table = await gridsService.table.get(view.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);

      // Gate at the view scope (most specific). The Wave 2.1 resolver
      // honours view-level deny grants here. We translate gate failure
      // to 404 instead of 403 so the deny semantics don't leak the
      // resource's existence — same policy listings already use.
      const viewer = currentActorViewer(c);
      const { level, grants } = await resolveWithGrants(c, {
        baseId: table.baseId,
        tableId: view.tableId,
        viewId: view.id,
      });
      if (!gridsService.permission.hasAtLeast(level, "read")) {
        return c.json({ message: "View not found" }, 404);
      }

      // Personal views: visible to the owner OR via an explicit view-
      // level grant. Inherited table-read alone does NOT make a personal
      // view visible to a non-owner.
      const isOwner = view.ownerUserId === viewer.userId;
      const explicitGrant = hasExplicitGrant(grants, "view", view.id);
      if (view.ownerUserId !== null && !isOwner && !explicitGrant) {
        return c.json({ message: "View not found" }, 404);
      }
      return c.json(view);
    },
  )

  .patch(
    "/:viewId",
    describeRoute({
      tags: ["Grids:View"],
      summary: "Update a view",
      responses: {
        200: jsonResponse(ViewSchema, "Updated"),
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    v("json", UpdateViewSchema),
    async (c) => {
      const viewId = c.req.param("viewId")!;
      const view = await gridsService.view.get(viewId);
      if (!view) return c.json({ message: "View not found" }, 404);
      const table = await gridsService.table.get(view.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const body = c.req.valid("json");
      if (body.shared === false && !currentActorUser(c)) return c.json({ message: "Sign in to make this view personal." }, 403);
      const isOwner = view.ownerUserId === currentActorViewer(c).userId;

      const gate = isOwner
        ? await gateAt(c, { baseId: table.baseId, tableId: table.id, viewId: view.id }, "read")
        : await gateAt(c, { baseId: table.baseId, tableId: table.id, viewId: view.id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      if (!isOwner && !gridsService.permission.hasAtLeast(gate.data, "admin")) {
        return c.json({ message: "Only view admins can update this view" }, 403);
      }
      const tableReadGate = await gateAt(c, { baseId: table.baseId, tableId: table.id }, "read");

      const compiled =
        body.source !== undefined
          ? await compileGqlViewWrite(c, {
              baseId: table.baseId,
              tableId: view.tableId,
              trustedAllSources: !tableReadGate.ok,
              ...(body.source !== undefined ? { source: body.source } : {}),
            })
          : null;
      if (compiled && !compiled.ok) return c.json({ message: gqlDiagnosticMessage(compiled.diagnostics) }, 400);

      return respond(c, () =>
        gridsService.view.update(
          viewId,
          {
            ...body,
            ...(compiled?.ok ? { source: compiled.source } : {}),
          },
          currentActorUserId(c),
        ),
      );
    },
  )

  .delete(
    "/:viewId",
    describeRoute({
      tags: ["Grids:View"],
      summary: "Delete a view",
      responses: {
        204: { description: "Deleted" },
        403: jsonResponse(ErrorResponseSchema, "Forbidden"),
      },
    }),
    async (c) => {
      const viewId = c.req.param("viewId")!;
      const view = await gridsService.view.get(viewId);
      if (!view) return c.json({ message: "View not found" }, 404);
      const table = await gridsService.table.get(view.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const isOwner = view.ownerUserId === currentActorViewer(c).userId;
      const gate = isOwner
        ? await gateAt(c, { baseId: table.baseId, tableId: table.id, viewId: view.id }, "read")
        : await gateAt(c, { baseId: table.baseId, tableId: table.id, viewId: view.id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      if (!isOwner && !gridsService.permission.hasAtLeast(gate.data, "admin")) {
        return c.json({ message: "Only view admins can delete this view" }, 403);
      }
      const result = await gridsService.view.remove(viewId, currentActorUserId(c));
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  )

  .post(
    "/:viewId/restore",
    describeRoute({
      tags: ["Grids:View"],
      summary: "Restore a soft-deleted view",
      responses: {
        200: jsonResponse(ViewSchema, "Restored"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const viewId = c.req.param("viewId")!;
      const view = await gridsService.view.get(viewId, { includeDeleted: true });
      if (!view) return c.json({ message: "View not found" }, 404);
      const table = await gridsService.table.get(view.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const isOwner = view.ownerUserId === currentActorViewer(c).userId;
      const gate = isOwner
        ? await gateAt(c, { baseId: table.baseId, tableId: table.id, viewId: view.id }, "read")
        : await gateAt(c, { baseId: table.baseId, tableId: table.id, viewId: view.id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      if (!isOwner && !gridsService.permission.hasAtLeast(gate.data, "admin")) {
        return c.json({ message: "Only view admins can restore this view" }, 403);
      }
      return respond(c, () => gridsService.view.restore(viewId, currentActorUserId(c)));
    },
  );

export default app;
