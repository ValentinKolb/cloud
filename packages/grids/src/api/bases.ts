import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { CreateBaseSchema, UpdateBaseSchema } from "../contracts";
import { RetentionPolicyInputSchema, RetentionPolicyResponseSchema, RetentionPreviewSchema } from "../retention-policy-contracts";
import { gridsService } from "../service";
import {
  currentActorUser,
  currentActorUserId,
  currentActorViewer,
  currentResourceBoundBaseId,
  gateAt,
  gateCredentialScope,
} from "./permissions";
import {
  PublicBaseListSchema,
  PublicBaseSchema,
  PublicFieldSchema,
  PublicFormSchema,
  PublicTableSchema,
  toPublicBase,
  toPublicBases,
  toPublicFields,
  toPublicForms,
  toPublicTables,
} from "./public-dto";
import { internalIdParam, requirePublicIdParam, requireStoredPublicIdParam } from "./route-params";

const TrashResponseSchema = z.object({
  tables: z.array(PublicTableSchema),
  fields: z.array(PublicFieldSchema),
  forms: z.array(PublicFormSchema),
});

export const createBasesApi = (deps: { requireAuthenticated?: MiddlewareHandler<AuthContext> } = {}) => {
  const requireAuthenticated = deps.requireAuthenticated ?? auth.requireRole("authenticated");

  return new Hono<AuthContext>()
    .use(requireAuthenticated)

    .get(
      "/",
      describeRoute({
        tags: ["Grids:Base"],
        summary: "List bases the user can access",
        responses: {
          200: jsonResponse(PublicBaseListSchema, "Bases"),
          400: jsonResponse(ErrorResponseSchema, "Invalid query"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v(
        "query",
        z.object({
          q: z.string().optional().default(""),
          limit: z.coerce.number().int().min(1).max(500).optional().default(100),
          offset: z.coerce.number().int().min(0).optional().default(0),
        }),
      ),
      async (c) => {
        const scopeGate = await gateCredentialScope(c, "read");
        if (!scopeGate.ok) return respond(c, () => Promise.resolve(scopeGate));
        const boundBaseId = currentResourceBoundBaseId(c);
        if (boundBaseId === null) return c.json({ message: "This API credential is not bound to a Grids base." }, 403);
        const viewer = currentActorViewer(c);
        const { q, limit, offset } = c.req.valid("query");
        const result = await gridsService.base.listVisible({
          ...viewer,
          ...(boundBaseId ? { baseId: boundBaseId } : {}),
          query: q,
          limit,
          offset,
        });
        return c.json({ ...result, items: toPublicBases(result.items), limit, offset });
      },
    )

    .post(
      "/",
      describeRoute({
        tags: ["Grids:Base"],
        summary: "Create a base",
        responses: {
          201: jsonResponse(PublicBaseSchema, "Created"),
          400: jsonResponse(ErrorResponseSchema, "Invalid input"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", CreateBaseSchema),
      async (c) => {
        const scopeGate = await gateCredentialScope(c, "write", { allowResourceBound: false });
        if (!scopeGate.ok) return respond(c, () => Promise.resolve(scopeGate));
        const user = currentActorUser(c);
        if (!user) return c.json({ message: "Sign in to create a base." }, 403);
        // User-backed actors with write-capable credentials become the base
        // admin through the access entry created by the service.
        const body = c.req.valid("json");
        const result = await gridsService.base.create({ name: body.name, description: body.description ?? null }, user.id);
        return result.ok ? c.json(toPublicBase(result.data), 201) : c.json({ message: result.error.message }, result.error.status);
      },
    )

    .get(
      "/:baseId",
      requirePublicIdParam("baseId", "base", "Base"),
      describeRoute({
        tags: ["Grids:Base"],
        summary: "Get a base",
        responses: {
          200: jsonResponse(PublicBaseSchema, "Base"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const baseId = internalIdParam(c, "baseId")!;
        const gate = await gateAt(c, { baseId }, "read");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const base = await gridsService.base.get(baseId);
        if (!base) return c.json({ message: "Base not found" }, 404);
        return c.json(toPublicBase(base));
      },
    )

    .patch(
      "/:baseId",
      requirePublicIdParam("baseId", "base", "Base"),
      describeRoute({
        tags: ["Grids:Base"],
        summary: "Update base metadata",
        responses: {
          200: jsonResponse(PublicBaseSchema, "Updated"),
          400: jsonResponse(ErrorResponseSchema, "Invalid input"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("json", UpdateBaseSchema),
      async (c) => {
        const baseId = internalIdParam(c, "baseId")!;
        const gate = await gateAt(c, { baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const body = c.req.valid("json");
        const result = await gridsService.base.update(baseId, body, currentActorUserId(c));
        return result.ok ? c.json(toPublicBase(result.data)) : c.json({ message: result.error.message }, result.error.status);
      },
    )

    .get(
      "/:baseId/retention-policy",
      requirePublicIdParam("baseId", "base", "Base"),
      describeRoute({
        tags: ["Grids:Base"],
        summary: "Read the Base retention floor",
        responses: {
          200: jsonResponse(RetentionPolicyResponseSchema, "Retention policy"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Base not found"),
        },
      }),
      async (c) => {
        const baseId = internalIdParam(c, "baseId")!;
        const gate = await gateAt(c, { baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const policy = await gridsService.base.retentionPolicy.get(baseId);
        return c.json({ policy: policy ? { baseId: c.req.param("baseId"), ...policy } : null });
      },
    )

    .post(
      "/:baseId/retention-policy/preview",
      requirePublicIdParam("baseId", "base", "Base"),
      describeRoute({
        tags: ["Grids:Base"],
        summary: "Preview a Base retention floor",
        responses: {
          200: jsonResponse(RetentionPreviewSchema, "Bounded retention preview"),
          400: jsonResponse(ErrorResponseSchema, "Invalid retention floor"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Base not found"),
        },
      }),
      v("json", RetentionPolicyInputSchema),
      async (c) => {
        const baseId = internalIdParam(c, "baseId")!;
        const gate = await gateAt(c, { baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        return c.json(await gridsService.base.retentionPolicy.preview(baseId, c.req.valid("json")));
      },
    )

    .put(
      "/:baseId/retention-policy",
      requirePublicIdParam("baseId", "base", "Base"),
      describeRoute({
        tags: ["Grids:Base"],
        summary: "Set the Base retention floor",
        responses: {
          200: jsonResponse(RetentionPolicyResponseSchema, "Retention policy updated"),
          400: jsonResponse(ErrorResponseSchema, "Invalid retention floor"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Base not found"),
        },
      }),
      v("json", RetentionPolicyInputSchema),
      async (c) => {
        const baseId = internalIdParam(c, "baseId")!;
        const gate = await gateAt(c, { baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const policy = await gridsService.base.retentionPolicy.update(baseId, c.req.valid("json"), currentActorUserId(c));
        return c.json({ policy: { baseId: c.req.param("baseId"), ...policy } });
      },
    )

    .delete(
      "/:baseId/retention-policy",
      requirePublicIdParam("baseId", "base", "Base"),
      describeRoute({
        tags: ["Grids:Base"],
        summary: "Remove the Base retention floor",
        responses: {
          204: { description: "Retention policy removed" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Base not found"),
        },
      }),
      async (c) => {
        const baseId = internalIdParam(c, "baseId")!;
        const gate = await gateAt(c, { baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        await gridsService.base.retentionPolicy.remove(baseId, currentActorUserId(c));
        return c.body(null, 204);
      },
    )

    .delete(
      "/:baseId",
      requirePublicIdParam("baseId", "base", "Base"),
      describeRoute({
        tags: ["Grids:Base"],
        summary: "Move a base to trash",
        responses: {
          204: { description: "Moved to trash" },
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const baseId = internalIdParam(c, "baseId")!;
        const gate = await gateAt(c, { baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const result = await gridsService.base.remove(baseId, currentActorUserId(c));
        if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
        return c.body(null, 204);
      },
    )

    .post(
      "/:baseId/restore",
      requireStoredPublicIdParam("baseId", "base", "Base"),
      describeRoute({
        tags: ["Grids:Base"],
        summary: "Restore a soft-deleted base",
        responses: {
          200: jsonResponse(PublicBaseSchema, "Restored"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const baseId = internalIdParam(c, "baseId")!;
        const gate = await gateAt(c, { baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const result = await gridsService.base.restore(baseId, currentActorUserId(c));
        return result.ok ? c.json(toPublicBase(result.data)) : c.json({ message: result.error.message }, result.error.status);
      },
    )

    .get(
      "/:baseId/trash",
      requirePublicIdParam("baseId", "base", "Base"),
      describeRoute({
        tags: ["Grids:Base"],
        summary: "List soft-deleted resources for a base (tables, fields, forms)",
        description:
          "Returns trashed tables, fields, and forms grouped by resource type. " +
          "Fields/forms whose parent table is itself trashed are excluded — they restore alongside the table.",
        responses: {
          200: jsonResponse(TrashResponseSchema, "Trashed resources"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (c) => {
        const baseId = internalIdParam(c, "baseId")!;
        // Trash management is a structural / recovery action — base-admin only.
        const gate = await gateAt(c, { baseId }, "admin");
        if (!gate.ok) return respond(c, () => Promise.resolve(gate));
        const [tables, fields, forms] = await Promise.all([
          gridsService.table.listTrashedByBase(baseId),
          gridsService.field.listTrashedByBase(baseId),
          // Forms is keyed by tableId, but listTrashedByBase joins
          // through tables for us. Returns full Form objects; the UI
          // only needs id / name / tableId / deletedAt though.
          gridsService.form.listTrashedByBase(baseId),
        ]);
        return c.json({ tables: await toPublicTables(tables), fields: await toPublicFields(fields), forms: await toPublicForms(forms) });
      },
    );
};

export default createBasesApi();
