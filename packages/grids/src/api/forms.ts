import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { FormConfigSchema, ShortIdSchema, UserInputFormFieldEntrySchema } from "../contracts";
import { gridsService } from "../service";
import type { FormSubmission } from "../service/form-submission";
import { currentActorUserId, gateAt } from "./permissions";

// FormFieldEntry is a tagged union. Stored entries without a `kind`
// are normalized to user_input by the service layer on read; the API
// contract requires the discriminator on writes.
//
// IMPORTANT: never reuse this for the *public* form response. form_value
// entries' `value` field MUST NOT leak to anonymous callers — that's
// the whole point of server-side application. The PublicFormSchema
// further down strips them.
const FormSchema = z.object({
  id: z.string(),
  // Persisted forms carry a 5-char short_id; the virtual "default form"
  // (id = `default-<tableId>`) has shortId: "" because it never appears
  // in URLs. Allow either to keep the virtual representable in the API.
  shortId: z.union([ShortIdSchema, z.literal("")]),
  tableId: z.string().uuid(),
  name: z.string(),
  config: FormConfigSchema,
  publicToken: z.string().nullable(),
  isActive: z.boolean(),
  ownerUserId: z.string().uuid().nullable(),
  position: z.number().int(),
  isDefault: z.boolean(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const InlineCreateDraftSchema = z.object({
  tempId: z.string().min(1).max(100),
  data: z.record(z.string(), z.unknown()),
});

const SubmitEnvelopeSchema = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  inlineCreates: z.record(z.string(), z.array(InlineCreateDraftSchema)).optional(),
});

const parseSubmission = (submitted: Record<string, unknown>): FormSubmission | null => {
  const envelopeLike =
    Object.prototype.hasOwnProperty.call(submitted, "data") || Object.prototype.hasOwnProperty.call(submitted, "inlineCreates");
  if (!envelopeLike) return { data: submitted, inlineCreates: {} };
  const parsed = SubmitEnvelopeSchema.safeParse(submitted);
  if (!parsed.success) return null;
  return { data: parsed.data.data ?? {}, inlineCreates: parsed.data.inlineCreates ?? {} };
};

// Public DTO returned from /forms/public/:token. Strips:
//   - form_value entries (their `value` is server-managed, mustn't leak)
//   - ownerUserId / deletedAt / publicToken / position / isDefault
//   - timestamps (not useful to anonymous callers)
// Title, description, submitLabel, successMessage, redirectUrl,
// user_input field entries — all rendered, all safe to ship.
const PublicFormSchema = z.object({
  id: z.string(),
  name: z.string(),
  config: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    fields: z.array(UserInputFormFieldEntrySchema),
    submitLabel: z.string().optional(),
    successMessage: z.string().optional(),
    redirectUrl: z.string().nullable().optional(),
    // titleImage is safe to ship publicly — the admin chose it.
    titleImage: z.string().max(1_000_000).optional(),
  }),
});

/**
 * Shared submit handler — used by both the anonymous public-token path
 * and the authenticated form-write path. Validates the payload against
 * the form's user-input + form-value entries (kind-aware: form_value
 * keys can't be overridden by the caller; user_input keys must hit
 * required/default rules), then creates the record.
 *
 * The actorId nullable carries through to record.create's created_by:
 * anonymous public submissions get null, authenticated submissions get
 * the user id so audit / row-history attribute correctly.
 */
const submitFormResponse = async (
  c: Context<AuthContext>,
  form: import("../service/forms").Form,
  submitted: Record<string, unknown>,
  actorId: string | null,
) => {
  const submission = parseSubmission(submitted);
  if (!submission) return c.json({ message: "Invalid form submission" }, 400);
  const dateConfig = await getDateConfig(c);
  return respond(c, () => gridsService.form.submit({ form, submission, actorId, dateConfig }), 201);
};
const toPublicForm = (f: import("../service/forms").Form): z.infer<typeof PublicFormSchema> => ({
  id: f.id,
  name: f.name,
  config: {
    title: f.config.title,
    description: f.config.description,
    fields: f.config.fields.filter((e): e is Extract<(typeof f.config.fields)[number], { kind: "user_input" }> => e.kind === "user_input"),
    submitLabel: f.config.submitLabel,
    successMessage: f.config.successMessage,
    redirectUrl: f.config.redirectUrl,
    titleImage: f.config.titleImage,
  },
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
      summary: "Fetch a public form by its share token (anonymous)",
      responses: {
        200: jsonResponse(PublicFormSchema, "Public form (sensitive fields stripped)"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    async (c) => {
      const token = c.req.param("token")!;
      const form = await gridsService.form.getByPublicToken(token);
      if (!form) return c.json({ message: "Form not found" }, 404);
      // Strip form_value entries' values, ownerUserId, publicToken,
      // timestamps. Anonymous callers see only what they need to render
      // the form — nothing else.
      return c.json(toPublicForm(form));
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
      const token = c.req.param("token")!;
      const form = await gridsService.form.getByPublicToken(token);
      if (!form) return c.json({ message: "Form not found" }, 404);
      // Anonymous submissions: actorId is null.
      return submitFormResponse(c, form, c.req.valid("json"), null);
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
      const tableId = c.req.param("tableId")!;
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
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const form = await gridsService.form.buildDefault(tableId);
      return c.json(form);
    },
  )

  // Authenticated submission. Distinct from /public/:token/submit
  // because it doesn't need the public token — instead it gates at
  // form-write OR table-write (table-write is a superset that always
  // implies submit). Lets a user with form-write submit a non-public
  // form they otherwise couldn't see.
  //
  // Permission semantics: form-write does NOT cascade to table-read;
  // the user can submit but won't see the resulting record unless they
  // ALSO have table-read. That's intentional — public-form-style
  // submission shouldn't suddenly grant inbox visibility.
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
    v("json", PublicSubmitSchema),
    async (c) => {
      const formId = c.req.param("formId")!;
      const form = await gridsService.form.get(formId);
      if (!form || !form.isActive) return c.json({ message: "Form not found" }, 404);
      const table = await gridsService.table.get(form.tableId);
      if (!table) return c.json({ message: "Form not found" }, 404);
      // Gate at form-write — most-specific-wins resolution lets a
      // table-write user pass through automatically (table-write
      // shadows the form-target's "none" default).
      const gate = await gateAt(c, { baseId: table.baseId, tableId: table.id, formId }, "write");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return submitFormResponse(c, form, c.req.valid("json"), currentActorUserId(c));
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
    async (c) => {
      const formId = c.req.param("formId")!;
      const form = await gridsService.form.get(formId);
      if (!form) return c.json({ message: "Form not found" }, 404);
      const table = await gridsService.table.get(form.tableId);
      if (!table) return c.json({ message: "Form not found" }, 404);
      const tableGate = await gateAt(c, { baseId: table.baseId, tableId: table.id }, "read");
      if (!tableGate.ok) {
        const formGate = await gateAt(c, { baseId: table.baseId, tableId: table.id, formId }, "write");
        if (!formGate.ok) return respond(c, () => Promise.resolve(formGate));
        return c.json(gridsService.form.toRenderableForm(form));
      }
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
      const tableId = c.req.param("tableId")!;
      const table = await gridsService.table.get(tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.form.create({ tableId, ...c.req.valid("json") }, currentActorUserId(c)), 201);
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
      const formId = c.req.param("formId")!;
      const form = await gridsService.form.get(formId);
      if (!form) return c.json({ message: "Form not found" }, 404);
      const table = await gridsService.table.get(form.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.form.update(formId, c.req.valid("json"), currentActorUserId(c)));
    },
  )

  .delete(
    "/:formId",
    describeRoute({
      tags: ["Grids:Form"],
      summary: "Delete a form (soft-delete; restorable for 30 days)",
      responses: { 204: { description: "Deleted" } },
    }),
    async (c) => {
      const formId = c.req.param("formId")!;
      const form = await gridsService.form.get(formId);
      if (!form) return c.json({ message: "Form not found" }, 404);
      const table = await gridsService.table.get(form.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.form.remove(formId, currentActorUserId(c));
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.body(null, 204);
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
    async (c) => {
      const formId = c.req.param("formId")!;
      const form = await gridsService.form.get(formId, { includeDeleted: true });
      if (!form) return c.json({ message: "Form not found" }, 404);
      const table = await gridsService.table.get(form.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.form.restore(formId, currentActorUserId(c)));
    },
  );

export default app;
