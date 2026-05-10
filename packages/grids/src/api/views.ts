import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import {
  ViewSchema,
  ViewListSchema,
  CreateViewSchema,
  UpdateViewSchema,
} from "../contracts";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import { gateAt, resolveWithGrants, hasExplicitGrant } from "./permissions";

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
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const list = await gridsService.view.listForTable({
        tableId,
        userId: user.id,
        userGroups: user.memberofGroupIds,
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
      const tableId = c.req.param("tableId");
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
      const user = c.get("user");
      return respond(
        c,
        () => gridsService.view.create(
          {
            tableId,
            name: body.name,
            query: body.query,
            ownerUserId: body.shared ? null : user.id,
          },
          user.id,
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
      const viewId = c.req.param("viewId");
      const view = await gridsService.view.get(viewId);
      if (!view) return c.json({ message: "View not found" }, 404);
      const table = await gridsService.table.get(view.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);

      // Gate at the view scope (most specific). The Wave 2.1 resolver
      // honours view-level deny grants here. We translate gate failure
      // to 404 instead of 403 so the deny semantics don't leak the
      // resource's existence — same policy listings already use.
      const user = c.get("user");
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
      const isAdmin = hasRole(user, "admin");
      const isOwner = view.ownerUserId === user.id;
      const explicitGrant = hasExplicitGrant(grants, isAdmin, "view", view.id);
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
      const viewId = c.req.param("viewId");
      const view = await gridsService.view.get(viewId);
      if (!view) return c.json({ message: "View not found" }, 404);
      const table = await gridsService.table.get(view.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const user = c.get("user");
      const body = c.req.valid("json");
      const isOwner = view.ownerUserId === user.id;

      // Ownership transitions (publish / unpublish) require base-admin
      // regardless of who owns the view today. Without this gate, a
      // table-reader who happens to own a personal view could flip
      // shared:true and publish to the whole base — an obvious privilege
      // escalation we shipped to alpha (chunk 7 critical).
      const isPublishing = body.shared === true && view.ownerUserId !== null;
      const isUnpublishing = body.shared === false && view.ownerUserId === null;

      let gate;
      if (isPublishing || isUnpublishing) {
        gate = await gateAt(c, { baseId: table.baseId }, "admin");
      } else if (view.ownerUserId === null) {
        // Editing an existing shared view: base-admin only.
        gate = await gateAt(c, { baseId: table.baseId }, "admin");
      } else if (isOwner) {
        // Editing one's own personal view: just need parent table-read.
        gate = await gateAt(c, { baseId: table.baseId, tableId: table.id }, "read");
      } else {
        // Editing someone else's personal view: base-admin only.
        gate = await gateAt(c, { baseId: table.baseId }, "admin");
      }
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));

      return respond(c, () => gridsService.view.update(viewId, body, user.id));
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
      const viewId = c.req.param("viewId");
      const view = await gridsService.view.get(viewId);
      if (!view) return c.json({ message: "View not found" }, 404);
      const table = await gridsService.table.get(view.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const user = c.get("user");
      const isOwner = view.ownerUserId === user.id;
      // Same gate shape as PATCH (minus the ownership-transition case,
      // which doesn't apply to delete). Shared view ⇒ base-admin.
      // Own personal view ⇒ table-read. Someone else's personal view
      // ⇒ base-admin.
      const gate = view.ownerUserId === null
        ? await gateAt(c, { baseId: table.baseId }, "admin")
        : isOwner
          ? await gateAt(c, { baseId: table.baseId, tableId: table.id }, "read")
          : await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.view.remove(viewId, user.id);
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
      const viewId = c.req.param("viewId");
      const view = await gridsService.view.get(viewId, { includeDeleted: true });
      if (!view) return c.json({ message: "View not found" }, 404);
      const table = await gridsService.table.get(view.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const user = c.get("user");
      const isOwner = view.ownerUserId === user.id;
      const gate = view.ownerUserId === null
        ? await gateAt(c, { baseId: table.baseId }, "admin")
        : await gateAt(c, { baseId: table.baseId, tableId: table.id }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      if (view.ownerUserId !== null && !isOwner) {
        return c.json({ message: "Only the owner can restore a personal view" }, 403);
      }
      return respond(c, () => gridsService.view.restore(viewId, user.id));
    },
  );

export default app;
