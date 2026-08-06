import type { AuthContext } from "@valentinkolb/cloud/server";
import { getDateConfig, respond } from "@valentinkolb/cloud/server";
import type { Context } from "hono";
import { z } from "zod";
import { FormConfigSchema, ShortIdSchema, UserInputFormFieldEntrySchema } from "../contracts";
import { gridsService } from "../service";
import { type FormSubmission, MAX_INLINE_CREATES_PER_FIELD, MAX_INLINE_CREATES_PER_SUBMISSION } from "../service/form-submission";
import type { Form } from "../service/forms";
import type { AuthorizedRecordAccess } from "../service/record-access";
import type { ExpansionViewer } from "../service/relation-access";

export const FormSchema = z.object({
  id: z.string(),
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

export const FormListSchema = z.array(FormSchema);

export const CreateFormSchema = z.object({
  name: z.string().min(1).max(200),
  config: FormConfigSchema.optional(),
  isPublic: z.boolean().optional(),
});

export const UpdateFormSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  config: FormConfigSchema.optional(),
  isPublic: z.boolean().optional(),
  isActive: z.boolean().optional(),
  position: z.number().int().optional(),
});

export const FormSubmitSchema = z.record(z.string(), z.unknown());

const InlineCreateDraftSchema = z.object({
  tempId: z.string().min(1).max(100),
  data: z.record(z.string(), z.unknown()),
});

const InlineCreatesSchema = z
  .record(z.string(), z.array(InlineCreateDraftSchema).max(MAX_INLINE_CREATES_PER_FIELD))
  .superRefine((groups, context) => {
    const total = Object.values(groups).reduce((count, drafts) => count + drafts.length, 0);
    if (total > MAX_INLINE_CREATES_PER_SUBMISSION) {
      context.addIssue({ code: "custom", message: `At most ${MAX_INLINE_CREATES_PER_SUBMISSION} related records may be created` });
    }
  });

const SubmitEnvelopeSchema = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  inlineCreates: InlineCreatesSchema.optional(),
});

export const parseFormSubmission = (submitted: Record<string, unknown>): FormSubmission | null => {
  const envelopeLike =
    Object.prototype.hasOwnProperty.call(submitted, "data") || Object.prototype.hasOwnProperty.call(submitted, "inlineCreates");
  if (!envelopeLike) return { data: submitted, inlineCreates: {} };
  const parsed = SubmitEnvelopeSchema.safeParse(submitted);
  if (!parsed.success) return null;
  return { data: parsed.data.data ?? {}, inlineCreates: parsed.data.inlineCreates ?? {} };
};

export const PublicFormSchema = z.object({
  id: z.string(),
  name: z.string(),
  config: FormConfigSchema.extend({
    fields: z.array(UserInputFormFieldEntrySchema),
  }),
});

export const toPublicForm = (form: Form): z.infer<typeof PublicFormSchema> => ({
  id: form.id,
  name: form.name,
  config: {
    title: form.config.title,
    description: form.config.description,
    fields: form.config.fields.filter(
      (entry): entry is Extract<(typeof form.config.fields)[number], { kind: "user_input" }> => entry.kind === "user_input",
    ),
    submitLabel: form.config.submitLabel,
    successMessage: form.config.successMessage,
    redirectUrl: form.config.redirectUrl,
    titleImage: form.config.titleImage,
  },
});

export type SubmitFormDeps = {
  submit?: typeof gridsService.form.submit;
  dateConfig?: typeof getDateConfig;
};

export const submitFormResponse = async (
  context: Context<AuthContext>,
  form: Form,
  submitted: Record<string, unknown>,
  actorId: string | null,
  deps: SubmitFormDeps = {},
  access?: { recordAccess: AuthorizedRecordAccess; viewer: ExpansionViewer },
) => {
  const submission = parseFormSubmission(submitted);
  if (!submission) return context.json({ message: "Invalid form submission" }, 400);
  const dateConfig = await (deps.dateConfig ?? getDateConfig)(context);
  const submit = deps.submit ?? gridsService.form.submit;
  return respond(context, () => submit({ form, submission, actorId, dateConfig, ...access }), 201);
};
