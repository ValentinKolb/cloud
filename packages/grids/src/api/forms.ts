import { Hono } from "hono";
import { z } from "zod";
import { describeRoute } from "hono-openapi";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import { gateAt } from "./permissions";

const FormFieldEntrySchema = z.object({
  fieldId: z.string(),
  label: z.string().optional(),
  helpText: z.string().optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
});

const FormConfigSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(FormFieldEntrySchema),
  submitLabel: z.string().optional(),
  successMessage: z.string().optional(),
  redirectUrl: z.string().nullable().optional(),
});

const FormSchema = z.object({
  id: z.string(),
  tableId: z.string().uuid(),
  name: z.string(),
  config: FormConfigSchema,
  publicToken: z.string().nullable(),
  isActive: z.boolean(),
  ownerUserId: z.string().uuid().nullable(),
  position: z.number().int(),
  isDefault: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const FormListSchema = z.array(FormSchema);

const CreateFormSchema = z.object({
  name: z.string().min(1).max(200),
  config: FormConfigSchema.optional(),
  isPublic: z.boolean().optional(),
});

const UpdateFormSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  config: FormConfigSchema.optional(),
  isPublic: z.boolean().optional(),
  isActive: z.boolean().optional(),
  position: z.number().int().optional(),
});

const PublicSubmitSchema = z.record(z.string(), z.unknown());

const app = new Hono<AuthContext>()

  // ── Public endpoints (no auth) ──────────────────────────────────────
  // Mount before the auth middleware so anonymous callers can hit them.
  .get(
    "/public/:token",
    describeRoute({
      tags: ["Grids:Form"],
      summary: "Fetch a public form by its share token",
      responses: {
        200: jsonResponse(FormSchema, "Form"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const token = c.req.param("token");
      const form = await gridsService.form.getByPublicToken(token);
      if (!form) return c.json({ message: "Form not found" }, 404);
      return c.json(form);
    },
  )

  .post(
    "/public/:token/submit",
    describeRoute({
      tags: ["Grids:Form"],
      summary: "Submit a public form (anonymous, no auth required)",
      responses: {
        201: jsonResponse(z.object({ recordId: z.string().uuid() }), "Created"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("json", PublicSubmitSchema),
    async (c) => {
      const token = c.req.param("token");
      const form = await gridsService.form.getByPublicToken(token);
      if (!form) return c.json({ message: "Form not found" }, 404);

      const submitted = c.req.valid("json");
      const formFields = form.config.fields ?? [];
      const allowedIds = new Set(formFields.map((f) => f.fieldId));

      // Reject any field the form doesn't expose. Public callers must NOT
      // be able to set fields the form-author chose to hide; otherwise a
      // form that asks for {name, email} could be abused to set
      // {name, email, internal_status, billing_amount, …}.
      for (const key of Object.keys(submitted)) {
        if (!allowedIds.has(key)) {
          return c.json({ message: `Field "${key}" is not part of this form` }, 400);
        }
      }

      // Apply form-level defaults + required overrides on top of the
      // submission. Defaults fill in for fields the user didn't touch;
      // missing required fields produce a clear 400.
      const payload: Record<string, unknown> = { ...submitted };
      for (const f of formFields) {
        if (payload[f.fieldId] === undefined && f.defaultValue !== undefined && f.defaultValue !== null) {
          payload[f.fieldId] = f.defaultValue;
        }
        if (f.required && (payload[f.fieldId] === undefined || payload[f.fieldId] === null || payload[f.fieldId] === "")) {
          return c.json({ message: `Field "${f.fieldId}" is required` }, 400);
        }
      }

      // Anonymous submissions: actorId is null. Record service stamps
      // created_by as null which is intentional.
      const result = await gridsService.record.create(form.tableId, payload, null);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.json({ recordId: result.data.id }, 201);
    },
  )

  // ── Authenticated endpoints ─────────────────────────────────────────
  .use(auth.requireRole("authenticated"))

  .get(
    "/by-table/:tableId",
    describeRoute({
      tags: ["Grids:Form"],
      summary: "List custom forms for a table (default form is virtual; use /default)",
      responses: { 200: jsonResponse(FormListSchema, "Forms") },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const list = await gridsService.form.listForTable(tableId);
      return c.json(list);
    },
  )

  .get(
    "/by-table/:tableId/default",
    describeRoute({
      tags: ["Grids:Form"],
      summary: "Fetch the virtual default form for a table",
      responses: { 200: jsonResponse(FormSchema, "Default form") },
    }),
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const form = await gridsService.form.buildDefault(tableId);
      return c.json(form);
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
    async (c) => {
      const tableId = c.req.param("tableId");
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(
        c,
        () => gridsService.form.create({ tableId, ...c.req.valid("json") }, user.id),
        201,
      );
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
    async (c) => {
      const formId = c.req.param("formId");
      const form = await gridsService.form.get(formId);
      if (!form) return c.json({ message: "Form not found" }, 404);
      const table = await gridsService.table.get(form.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId: table.id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(c, () => gridsService.form.update(formId, c.req.valid("json"), user.id));
    },
  )

  .delete(
    "/:formId",
    describeRoute({
      tags: ["Grids:Form"],
      summary: "Delete a form",
      responses: { 204: { description: "Deleted" } },
    }),
    async (c) => {
      const formId = c.req.param("formId");
      const form = await gridsService.form.get(formId);
      if (!form) return c.json({ message: "Form not found" }, 404);
      const table = await gridsService.table.get(form.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId: table.id }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.form.remove(formId, user.id);
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
    },
  );

export default app;
