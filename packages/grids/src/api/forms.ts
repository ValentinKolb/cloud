import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, getDateConfig, jsonResponse, respond, v } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { FormConfigSchema, ShortIdSchema, UserInputFormFieldEntrySchema } from "../contracts";
import { gridsService } from "../service";
import { materializeFieldDefault } from "../service/fields";
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

type ParsedSubmit = {
  data: Record<string, unknown>;
  inlineCreates: Record<string, Array<z.infer<typeof InlineCreateDraftSchema>>>;
};

class SubmitFailure extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 500 = 400,
  ) {
    super(message);
  }
}

const parseSubmission = (submitted: Record<string, unknown>): ParsedSubmit | SubmitFailure => {
  const envelopeLike =
    Object.prototype.hasOwnProperty.call(submitted, "data") || Object.prototype.hasOwnProperty.call(submitted, "inlineCreates");
  if (!envelopeLike) return { data: submitted, inlineCreates: {} };
  const parsed = SubmitEnvelopeSchema.safeParse(submitted);
  if (!parsed.success) return new SubmitFailure("Invalid form submission");
  return { data: parsed.data.data ?? {}, inlineCreates: parsed.data.inlineCreates ?? {} };
};

const submitFailureStatus = (status: number): SubmitFailure["status"] =>
  status === 403 || status === 404 || status === 409 || status === 500 ? status : 400;

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
  const parsedSubmit = parseSubmission(submitted);
  if (parsedSubmit instanceof SubmitFailure) return c.json({ message: parsedSubmit.message }, parsedSubmit.status);
  const { data: submittedData, inlineCreates } = parsedSubmit;
  const formFields = form.config.fields ?? [];
  const fields = await gridsService.field.listByTable(form.tableId);
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const dateConfig = await getDateConfig(c);
  const entriesById = new Map(formFields.map((entry) => [entry.fieldId, entry]));
  const fieldName = (fieldId: string) => {
    const entry = entriesById.get(fieldId);
    if (entry?.kind === "user_input" && entry.label?.trim()) return entry.label.trim();
    return fieldsById.get(fieldId)?.name ?? "Unknown field";
  };

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

  for (const key of Object.keys(submittedData)) {
    if (formValueIds.has(key)) {
      return c.json({ message: `Field "${fieldName(key)}" is server-managed and cannot be set via the form` }, 400);
    }
    if (!userInputIds.has(key)) {
      return c.json({ message: `Field "${fieldName(key)}" is not part of this form` }, 400);
    }
  }

  // Build payload: user input first, then user_input defaults for
  // missing keys, then form_value entries (which always win — their
  // keys are blocked from the user's payload upstream).
  const payload: Record<string, unknown> = { ...submittedData };
  for (const e of formFields) {
    if (e.kind !== "user_input") continue;
    if (payload[e.fieldId] === undefined && e.defaultValue !== undefined && e.defaultValue !== null) {
      const field = fieldsById.get(e.fieldId);
      payload[e.fieldId] = field ? materializeFieldDefault({ ...field, defaultValue: e.defaultValue }, { dateConfig }) : e.defaultValue;
    }
    if (e.required && (payload[e.fieldId] === undefined || payload[e.fieldId] === null || payload[e.fieldId] === "")) {
      return c.json({ message: `Field "${fieldName(e.fieldId)}" is required` }, 400);
    }
  }
  for (const e of formFields) {
    if (e.kind === "form_value") {
      const field = fieldsById.get(e.fieldId);
      payload[e.fieldId] = field ? materializeFieldDefault({ ...field, defaultValue: e.value }, { dateConfig }) : e.value;
    }
  }

  const createdEventIds: string[] = [];
  try {
    const mainRecordId = await sql.begin(async (tx) => {
      for (const [relationFieldId, drafts] of Object.entries(inlineCreates)) {
        if (drafts.length === 0) continue;
        const entry = entriesById.get(relationFieldId);
        const relationField = fieldsById.get(relationFieldId);
        if (entry?.kind !== "user_input" || !entry.inlineCreate?.enabled || !relationField || relationField.type !== "relation") {
          throw new SubmitFailure(`Field "${fieldName(relationFieldId)}" does not allow creating related records`);
        }
        const targetTableId = (relationField.config as { targetTableId?: unknown }).targetTableId;
        if (typeof targetTableId !== "string") throw new SubmitFailure(`Field "${fieldName(relationFieldId)}" has no target table`);
        const cardinality = (relationField.config as { cardinality?: "single" | "multiple" }).cardinality ?? "multiple";
        const allowedInlineEntries = entry.inlineCreate.fields ?? [];
        const allowedInlineIds = new Set(allowedInlineEntries.map((inlineEntry) => inlineEntry.fieldId));
        const targetFields = await gridsService.field.listByTable(targetTableId);
        const targetFieldsById = new Map(targetFields.map((field) => [field.id, field]));

        for (const draft of drafts) {
          if (!draft.tempId.startsWith("tmp_"))
            throw new SubmitFailure(`Field "${fieldName(relationFieldId)}" has an invalid inline draft id`);
          for (const key of Object.keys(draft.data)) {
            if (!allowedInlineIds.has(key))
              throw new SubmitFailure(`Field "${fieldName(relationFieldId)}" contains a field that cannot be created inline`);
          }
        }

        const currentIds = Array.isArray(payload[relationFieldId])
          ? (payload[relationFieldId] as unknown[]).filter((id): id is string => typeof id === "string")
          : typeof payload[relationFieldId] === "string"
            ? [payload[relationFieldId] as string]
            : [];
        const draftIds = drafts.map((draft) => draft.tempId);
        const existingIds = currentIds.filter((id) => !draftIds.includes(id));
        if (cardinality === "single" && (drafts.length > 1 || (drafts.length > 0 && existingIds.length > 0))) {
          throw new SubmitFailure(`Field "${fieldName(relationFieldId)}" can link either one existing record or one new record`);
        }

        const replacement = new Map<string, string>();
        for (const draft of drafts) {
          const draftPayload: Record<string, unknown> = { ...draft.data };
          for (const inlineEntry of allowedInlineEntries) {
            const targetField = targetFieldsById.get(inlineEntry.fieldId);
            if (!targetField) throw new SubmitFailure(`Field "${fieldName(relationFieldId)}" inline configuration is stale`);
            if (
              draftPayload[inlineEntry.fieldId] === undefined &&
              inlineEntry.defaultValue !== undefined &&
              inlineEntry.defaultValue !== null
            ) {
              draftPayload[inlineEntry.fieldId] = materializeFieldDefault(
                { ...targetField, defaultValue: inlineEntry.defaultValue },
                { dateConfig },
              );
            }
            if (
              (inlineEntry.required || targetField.required) &&
              (draftPayload[inlineEntry.fieldId] === undefined ||
                draftPayload[inlineEntry.fieldId] === null ||
                draftPayload[inlineEntry.fieldId] === "")
            ) {
              throw new SubmitFailure(`Field "${inlineEntry.label?.trim() || targetField.name}" is required`);
            }
          }
          const created = await gridsService.record.createInTransaction(tx, targetTableId, draftPayload, actorId, {
            bypassDirectInsertCheck: true,
            dateConfig,
          });
          if (!created.ok) throw new SubmitFailure(created.error.message, submitFailureStatus(created.error.status));
          replacement.set(draft.tempId, created.data.record.id);
          createdEventIds.push(created.data.outboxId);
        }

        const sourceIds = currentIds.length > 0 ? [...currentIds] : [...draftIds];
        if (cardinality !== "single") {
          for (const draftId of draftIds) {
            if (!sourceIds.includes(draftId)) sourceIds.push(draftId);
          }
        }
        const nextIds = sourceIds.map((id) => replacement.get(id) ?? id);
        payload[relationFieldId] = nextIds;
      }

      const created = await gridsService.record.createInTransaction(tx, form.tableId, payload, actorId, {
        bypassDirectInsertCheck: true,
        dateConfig,
      });
      if (!created.ok) throw new SubmitFailure(created.error.message, submitFailureStatus(created.error.status));
      createdEventIds.push(created.data.outboxId);
      return created.data.record.id;
    });

    for (const outboxId of createdEventIds) gridsService.record.notifyEvent(outboxId);
    return c.json({ recordId: mainRecordId }, 201);
  } catch (e) {
    if (e instanceof SubmitFailure) return c.json({ message: e.message }, e.status);
    throw e;
  }
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
