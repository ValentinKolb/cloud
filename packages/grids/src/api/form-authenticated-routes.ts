import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { gridsService } from "../service";
import {
  CreateFormSchema,
  FormListSchema,
  FormSchema,
  FormSubmitSchema,
  type SubmitFormDeps,
  submitFormResponse,
  UpdateFormSchema,
} from "./form-api-shared";
import { currentActorUserId, gateAt } from "./permissions";

type AuthenticatedFormRoutesDeps = SubmitFormDeps & {
  service?: typeof gridsService;
  gate?: typeof gateAt;
  actorId?: typeof currentActorUserId;
};

export const createAuthenticatedFormRoutes = (deps: AuthenticatedFormRoutesDeps = {}) => {
  const service = deps.service ?? gridsService;
  const gateAtTarget = deps.gate ?? gateAt;
  const actorId = deps.actorId ?? currentActorUserId;

  return new Hono<AuthContext>()
    .get(
      "/by-table/:tableId",
      describeRoute({
        tags: ["Grids:Form"],
        summary: "List custom forms for a table (default form is virtual; use /default)",
        responses: { 200: jsonResponse(FormListSchema, "Forms") },
      }),
      async (context) => {
        const tableId = context.req.param("tableId")!;
        const table = await service.table.get(tableId);
        if (!table) return context.json({ message: "Table not found" }, 404);
        const gate = await gateAtTarget(context, { baseId: table.baseId, tableId }, "read");
        if (!gate.ok) return respond(context, () => Promise.resolve(gate));
        return context.json(await service.form.listForTable(tableId));
      },
    )
    .get(
      "/by-table/:tableId/default",
      describeRoute({
        tags: ["Grids:Form"],
        summary: "Fetch the virtual default form for a table",
        responses: { 200: jsonResponse(FormSchema, "Default form") },
      }),
      async (context) => {
        const tableId = context.req.param("tableId")!;
        const table = await service.table.get(tableId);
        if (!table) return context.json({ message: "Table not found" }, 404);
        const gate = await gateAtTarget(context, { baseId: table.baseId, tableId }, "read");
        if (!gate.ok) return respond(context, () => Promise.resolve(gate));
        return context.json(await service.form.buildDefault(tableId));
      },
    )
    .post(
      "/:formId/submit",
      describeRoute({
        tags: ["Grids:Form"],
        summary: "Submit a form (authenticated, form-write or table-write)",
        responses: {
          201: jsonResponse(z.object({ recordId: z.string().uuid() }), "Created"),
          400: jsonResponse(ErrorResponseSchema, "Invalid input"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("json", FormSubmitSchema),
      async (context) => {
        const formId = context.req.param("formId")!;
        const form = await service.form.get(formId);
        if (!form || !form.isActive) return context.json({ message: "Form not found" }, 404);
        const table = await service.table.get(form.tableId);
        if (!table) return context.json({ message: "Form not found" }, 404);
        const gate = await gateAtTarget(context, { baseId: table.baseId, tableId: table.id, formId }, "write");
        if (!gate.ok) return respond(context, () => Promise.resolve(gate));
        return submitFormResponse(context, form, context.req.valid("json"), actorId(context), deps);
      },
    )
    .get(
      "/:formId",
      describeRoute({
        tags: ["Grids:Form"],
        summary: "Get a single form",
        responses: {
          200: jsonResponse(FormSchema, "Form"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (context) => {
        const formId = context.req.param("formId")!;
        const form = await service.form.get(formId);
        if (!form) return context.json({ message: "Form not found" }, 404);
        const table = await service.table.get(form.tableId);
        if (!table) return context.json({ message: "Form not found" }, 404);
        const tableGate = await gateAtTarget(context, { baseId: table.baseId, tableId: table.id }, "read");
        if (!tableGate.ok) {
          const formGate = await gateAtTarget(context, { baseId: table.baseId, tableId: table.id, formId }, "write");
          if (!formGate.ok) return respond(context, () => Promise.resolve(formGate));
          return context.json(service.form.toRenderableForm(form));
        }
        return context.json(form);
      },
    )
    .post(
      "/by-table/:tableId",
      describeRoute({
        tags: ["Grids:Form"],
        summary: "Create a custom form",
        responses: {
          201: jsonResponse(FormSchema, "Created"),
          403: jsonResponse(ErrorResponseSchema, "Forbidden"),
        },
      }),
      v("json", CreateFormSchema),
      async (context) => {
        const tableId = context.req.param("tableId")!;
        const table = await service.table.get(tableId);
        if (!table) return context.json({ message: "Table not found" }, 404);
        const gate = await gateAtTarget(context, { baseId: table.baseId }, "admin");
        if (!gate.ok) return respond(context, () => Promise.resolve(gate));
        return respond(context, () => service.form.create({ tableId, ...context.req.valid("json") }, actorId(context)), 201);
      },
    )
    .patch(
      "/:formId",
      describeRoute({
        tags: ["Grids:Form"],
        summary: "Update a form",
        responses: { 200: jsonResponse(FormSchema, "Updated") },
      }),
      v("json", UpdateFormSchema),
      async (context) => {
        const formId = context.req.param("formId")!;
        const form = await service.form.get(formId);
        if (!form) return context.json({ message: "Form not found" }, 404);
        const table = await service.table.get(form.tableId);
        if (!table) return context.json({ message: "Table not found" }, 404);
        const gate = await gateAtTarget(context, { baseId: table.baseId }, "admin");
        if (!gate.ok) return respond(context, () => Promise.resolve(gate));
        return respond(context, () => service.form.update(formId, context.req.valid("json"), actorId(context)));
      },
    )
    .delete(
      "/:formId",
      describeRoute({
        tags: ["Grids:Form"],
        summary: "Delete a form (soft-delete; restorable for 30 days)",
        responses: { 204: { description: "Deleted" } },
      }),
      async (context) => {
        const formId = context.req.param("formId")!;
        const form = await service.form.get(formId);
        if (!form) return context.json({ message: "Form not found" }, 404);
        const table = await service.table.get(form.tableId);
        if (!table) return context.json({ message: "Table not found" }, 404);
        const gate = await gateAtTarget(context, { baseId: table.baseId }, "admin");
        if (!gate.ok) return respond(context, () => Promise.resolve(gate));
        const result = await service.form.remove(formId, actorId(context));
        if (!result.ok) return context.json({ message: result.error.message }, result.error.status);
        return context.body(null, 204);
      },
    )
    .post(
      "/:formId/restore",
      describeRoute({
        tags: ["Grids:Form"],
        summary: "Restore a soft-deleted form",
        responses: {
          200: jsonResponse(FormSchema, "Restored"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (context) => {
        const formId = context.req.param("formId")!;
        const form = await service.form.get(formId, { includeDeleted: true });
        if (!form) return context.json({ message: "Form not found" }, 404);
        const table = await service.table.get(form.tableId);
        if (!table) return context.json({ message: "Table not found" }, 404);
        const gate = await gateAtTarget(context, { baseId: table.baseId }, "admin");
        if (!gate.ok) return respond(context, () => Promise.resolve(gate));
        return respond(context, () => service.form.restore(formId, actorId(context)));
      },
    );
};

export const authenticatedFormRoutes = createAuthenticatedFormRoutes();
