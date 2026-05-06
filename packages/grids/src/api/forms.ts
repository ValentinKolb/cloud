import { Hono, type Context } from "hono";
import { z } from "zod";
import { describeRoute } from "hono-openapi";
import { auth, v, respond, jsonResponse, type AuthContext } from "@valentinkolb/cloud/server";
import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import { gateAt } from "./permissions";

// v3 Slice 6: tagged-union FormFieldEntry. Pre-v3 entries (no `kind`)
// are normalized to user_input by the service layer on read; the API
// contract still requires the discriminator on writes.
//
// IMPORTANT: never reuse this for the *public* form response. form_value
// entries' `value` field MUST NOT leak to anonymous callers — that's
// the whole point of server-side application. The PublicFormSchema
// further down strips them.
const UserInputEntrySchema = z.object({
  kind: z.literal("user_input"),
  fieldId: z.string().uuid(),
  label: z.string().optional(),
  helpText: z.string().optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
});
const FormValueEntrySchema = z.object({
  kind: z.literal("form_value"),
  fieldId: z.string().uuid(),
  value: z.unknown(),
});
const FormFieldEntrySchema = z.discriminatedUnion("kind", [
  UserInputEntrySchema,
  FormValueEntrySchema,
]);

const FormConfigSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(FormFieldEntrySchema),
  submitLabel: z.string().optional(),
  successMessage: z.string().optional(),
  redirectUrl: z.string().nullable().optional(),
});

// FieldSnapshot lives on the response; we don't expose its schema in
// detail because it mirrors FieldSchema and would be a maintenance
// burden to keep in sync. z.unknown() lets clients use it raw.
const FormSchema = z.object({
  id: z.string(),
  tableId: z.string().uuid(),
  name: z.string(),
  config: FormConfigSchema,
  fieldSnapshot: z.array(z.unknown()),
  publicToken: z.string().nullable(),
  isActive: z.boolean(),
  ownerUserId: z.string().uuid().nullable(),
  position: z.number().int(),
  isDefault: z.boolean(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Public DTO returned from /forms/public/:token. Strips:
//   - form_value entries (their `value` is server-managed, mustn't leak)
//   - fieldSnapshot (internal — schema details aren't part of the public surface)
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
    fields: z.array(UserInputEntrySchema),
    submitLabel: z.string().optional(),
    successMessage: z.string().optional(),
    redirectUrl: z.string().nullable().optional(),
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
  const formFields = form.config.fields ?? [];

  // Split entries by kind. user_input fields accept payload from the
  // caller; form_value fields are SERVER-applied and the user's
  // payload for those keys is rejected (so a form that locks
  // `source = "website"` can't be subverted by a hand-crafted POST).
  const userInputIds = new Set<string>();
  const formValueIds = new Set<string>();
  for (const e of formFields) {
    if (e.kind === "user_input") userInputIds.add(e.fieldId);
    else formValueIds.add(e.fieldId);
  }

  for (const key of Object.keys(submitted)) {
    if (formValueIds.has(key)) {
      return c.json({ message: `Field "${key}" is server-managed and cannot be set via the form` }, 400);
    }
    if (!userInputIds.has(key)) {
      return c.json({ message: `Field "${key}" is not part of this form` }, 400);
    }
  }

  // Build payload: user input first, then user_input defaults for
  // missing keys, then form_value entries (which always win — their
  // keys are blocked from the user's payload upstream).
  const payload: Record<string, unknown> = { ...submitted };
  for (const e of formFields) {
    if (e.kind !== "user_input") continue;
    if (payload[e.fieldId] === undefined && e.defaultValue !== undefined && e.defaultValue !== null) {
      payload[e.fieldId] = e.defaultValue;
    }
    if (e.required && (payload[e.fieldId] === undefined || payload[e.fieldId] === null || payload[e.fieldId] === "")) {
      return c.json({ message: `Field "${e.fieldId}" is required` }, 400);
    }
  }
  for (const e of formFields) {
    if (e.kind === "form_value") payload[e.fieldId] = e.value;
  }

  // Bypass `disable_direct_insert` — that gate is meant to BLOCK
  // direct API/grid inserts. Form-submit IS the intended pathway for
  // such tables, so we always allow it here.
  const result = await gridsService.record.create(form.tableId, payload, actorId, {
    bypassDirectInsertCheck: true,
  });
  if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
  return c.json({ recordId: result.data.id }, 201);
};

const toPublicForm = (
  f: import("../service/forms").Form,
): z.infer<typeof PublicFormSchema> => ({
  id: f.id,
  name: f.name,
  config: {
    title: f.config.title,
    description: f.config.description,
    fields: f.config.fields.filter(
      (e): e is Extract<typeof f.config.fields[number], { kind: "user_input" }> =>
        e.kind === "user_input",
    ),
    submitLabel: f.config.submitLabel,
    successMessage: f.config.successMessage,
    redirectUrl: f.config.redirectUrl,
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
      const token = c.req.param("token");
      const form = await gridsService.form.getByPublicToken(token);
      if (!form) return c.json({ message: "Form not found" }, 404);
      // Strip form_value entries' values, fieldSnapshot, ownerUserId,
      // publicToken, timestamps. Anonymous callers see only what they
      // need to render the form — nothing else.
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
      const token = c.req.param("token");
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
      const formId = c.req.param("formId");
      const form = await gridsService.form.get(formId);
      if (!form || !form.isActive) return c.json({ message: "Form not found" }, 404);
      const table = await gridsService.table.get(form.tableId);
      if (!table) return c.json({ message: "Form not found" }, 404);
      // Gate at form-write — most-specific-wins resolution lets a
      // table-write user pass through automatically (table-write
      // shadows the form-target's "none" default).
      const gate = await gateAt(
        c,
        { baseId: table.baseId, tableId: table.id, formId },
        "write",
      );
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return submitFormResponse(c, form, c.req.valid("json"), user.id);
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
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
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
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(c, () => gridsService.form.update(formId, c.req.valid("json"), user.id));
    },
  )

  .post(
    "/:formId/re-snapshot",
    describeRoute({
      tags: ["Grids:Form"],
      summary: "Refresh the form's frozen field snapshot from current fields",
      responses: { 200: jsonResponse(FormSchema, "Re-snapshotted") },
    }),
    async (c) => {
      const formId = c.req.param("formId");
      const form = await gridsService.form.get(formId);
      if (!form) return c.json({ message: "Form not found" }, 404);
      const table = await gridsService.table.get(form.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(c, () => gridsService.form.reSnapshot(formId, user.id));
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
      const formId = c.req.param("formId");
      const form = await gridsService.form.get(formId);
      if (!form) return c.json({ message: "Form not found" }, 404);
      const table = await gridsService.table.get(form.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      const result = await gridsService.form.remove(formId, user.id);
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
      const formId = c.req.param("formId");
      const form = await gridsService.form.get(formId, { includeDeleted: true });
      if (!form) return c.json({ message: "Form not found" }, 404);
      const table = await gridsService.table.get(form.tableId);
      if (!table) return c.json({ message: "Table not found" }, 404);
      const gate = await gateAt(c, { baseId: table.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const user = c.get("user");
      return respond(c, () => gridsService.form.restore(formId, user.id));
    },
  );

export default app;
