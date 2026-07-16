import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { jsonResponse, requiresAuth } from "@valentinkolb/cloud/server";
import type { WorkflowBoundPlan, WorkflowCondition, WorkflowIr, WorkflowIrStep, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  type MailWorkflow,
  type MailWorkflowDetail,
  type MailWorkflowPreflight,
  type MailWorkflowRun,
  type MailWorkflowRunTarget,
  type MailWorkflowVersion,
  type WorkflowValidation,
  workflowEffectBudgetSchema,
  workflowRunChannelSchema,
  workflowRunKindSchema,
  workflowRunModeSchema,
  workflowRunStateSchema,
  workflowRunTargetSelectionSchema,
  workflowTargetStateSchema,
} from "../contracts";

const responseSchema =
  <T>() =>
  <S extends z.ZodType<T>>(schema: S): S =>
    schema;

const workflowJsonValueSchema = z.unknown().meta({
  $dynamicAnchor: "WorkflowJsonValue",
  oneOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
    { type: "array", items: { $dynamicRef: "#WorkflowJsonValue" } },
    { type: "object", additionalProperties: { $dynamicRef: "#WorkflowJsonValue" } },
  ],
}) as z.ZodType<WorkflowJsonValue>;
const workflowJsonObjectSchema = z.record(z.string(), workflowJsonValueSchema);
const workflowHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const workflowSourceLocationSchema = z.object({
  offset: z.number().int().nonnegative(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});
const workflowDiagnosticSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
  path: z.array(z.union([z.string(), z.number()])),
  location: workflowSourceLocationSchema.optional(),
});
const workflowConditionSchema: z.ZodType<WorkflowCondition> = z.lazy(() =>
  z.discriminatedUnion("operator", [
    z.object({
      operator: z.enum(["equals", "notEquals", "contains", "startsWith", "endsWith"]),
      operands: z.tuple([workflowJsonValueSchema, workflowJsonValueSchema]),
    }),
    z.object({ operator: z.literal("exists"), reference: z.string() }),
    z.object({ operator: z.literal("all"), conditions: z.array(workflowConditionSchema) }),
    z.object({ operator: z.literal("any"), conditions: z.array(workflowConditionSchema) }),
    z.object({ operator: z.literal("not"), condition: workflowConditionSchema }),
  ]),
);
const workflowIrStepSchema: z.ZodType<WorkflowIrStep> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("action"),
      action: z.string(),
      config: workflowJsonObjectSchema,
      sourcePath: z.array(z.union([z.string(), z.number()])),
    }),
    z.object({
      kind: z.literal("if"),
      condition: workflowConditionSchema,
      then: z.array(workflowIrStepSchema),
      else: z.array(workflowIrStepSchema),
      sourcePath: z.array(z.union([z.string(), z.number()])),
    }),
    z.object({
      kind: z.literal("switch"),
      value: workflowJsonValueSchema,
      cases: z.array(z.object({ when: workflowJsonValueSchema, steps: z.array(workflowIrStepSchema) })),
      default: z.array(workflowIrStepSchema),
      sourcePath: z.array(z.union([z.string(), z.number()])),
    }),
    z.object({
      kind: z.literal("forEach"),
      reference: z.string(),
      alias: z.string(),
      steps: z.array(workflowIrStepSchema),
      sourcePath: z.array(z.union([z.string(), z.number()])),
    }),
  ]),
);
const workflowIrShapeSchema = z.object({
  schemaVersion: z.literal(1),
  languageId: z.string(),
  languageVersion: z.number().int().positive(),
  sourceHash: workflowHashSchema,
  manifestHash: workflowHashSchema,
  inputs: z.array(z.object({ name: z.string(), type: z.string(), config: workflowJsonObjectSchema })),
  triggers: z.array(z.object({ kind: z.string(), config: workflowJsonObjectSchema, with: workflowJsonObjectSchema })),
  steps: z.array(workflowIrStepSchema),
  sourceLocations: z.record(z.string(), workflowSourceLocationSchema),
});
const workflowIrSchema = responseSchema<WorkflowIr>()(workflowIrShapeSchema);
const workflowBoundPlanSchema = responseSchema<WorkflowBoundPlan>()(
  z.object({
    schemaVersion: z.literal(2),
    languageId: z.string(),
    languageVersion: z.number().int().positive(),
    sourceHash: workflowHashSchema,
    manifestHash: workflowHashSchema,
    catalogHash: workflowHashSchema,
    maxLoopItems: z.number().int().positive().optional(),
    actionPolicies: z.record(
      z.string(),
      z.object({
        effect: z.enum(["pure", "transactional", "durable-intent", "ambiguous-external"]),
        dryRun: z.enum(["full", "validate", "unsupported"]),
      }),
    ),
    inputs: workflowIrShapeSchema.shape.inputs,
    triggers: workflowIrShapeSchema.shape.triggers,
    steps: workflowIrShapeSchema.shape.steps,
    bindings: workflowJsonObjectSchema,
  }),
);

export const workflowValidationSchema = responseSchema<WorkflowValidation>()(
  z.object({
    valid: z.boolean(),
    source: z.string(),
    sourceHash: workflowHashSchema.nullable(),
    ir: workflowIrSchema.nullable(),
    boundPlan: workflowBoundPlanSchema.nullable(),
    diagnostics: z.array(workflowDiagnosticSchema),
  }),
);
export const mailWorkflowSchema = responseSchema<MailWorkflow>()(
  z.object({
    id: z.string().uuid(),
    mailboxId: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    priority: z.number().int(),
    currentVersionId: z.string().uuid(),
    activeVersionId: z.string().uuid().nullable(),
    enabled: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);
export const mailWorkflowVersionSchema = responseSchema<MailWorkflowVersion>()(
  z.object({
    id: z.string().uuid(),
    identity: z.string(),
    workflowId: z.string().uuid(),
    mailboxId: z.string().uuid(),
    source: z.string(),
    sourceHash: workflowHashSchema,
    ir: workflowIrSchema,
    boundPlan: workflowBoundPlanSchema,
    diagnostics: z.array(workflowDiagnosticSchema),
    effectBudget: workflowEffectBudgetSchema,
    languageId: z.string(),
    languageVersion: z.number().int().positive(),
    manifestHash: workflowHashSchema,
    catalogHash: workflowHashSchema,
    compiler: z.object({ name: z.string(), version: z.string() }),
    createdAt: z.string().datetime(),
  }),
);
const mailWorkflowActivationSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersionId: z.string().uuid(),
  key: z.string(),
  kind: z.string(),
  config: workflowJsonObjectSchema,
  enabled: z.boolean(),
  diagnostics: z.array(workflowDiagnosticSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const mailWorkflowDetailSchema = responseSchema<MailWorkflowDetail>()(
  mailWorkflowSchema.extend({
    currentVersion: mailWorkflowVersionSchema,
    activations: z.array(mailWorkflowActivationSchema),
  }),
);
export const mailWorkflowPreflightSchema = responseSchema<MailWorkflowPreflight>()(
  z.object({
    workflowVersionId: z.string().uuid(),
    versionIdentity: z.string(),
    sourceHash: workflowHashSchema,
    queryHash: workflowHashSchema,
    preflightHash: workflowHashSchema,
    occurredAt: z.string().datetime(),
    effectBudget: workflowEffectBudgetSchema,
    actionCounts: z.record(z.string(), z.number().int().nonnegative()),
    targetCount: z.number().int().nonnegative(),
  }),
);
const workflowExecutionErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
const workflowTargetProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
  needs_attention: z.number().int().nonnegative(),
});
export const mailWorkflowRunSchema = responseSchema<MailWorkflowRun>()(
  z.object({
    id: z.string().uuid(),
    mailboxId: z.string().uuid(),
    workflowId: z.string().uuid(),
    workflowVersionId: z.string().uuid(),
    versionIdentity: z.string(),
    sourceHash: workflowHashSchema,
    kind: workflowRunKindSchema,
    mode: workflowRunModeSchema,
    channel: workflowRunChannelSchema,
    state: workflowRunStateSchema,
    inputs: workflowJsonObjectSchema,
    query: workflowRunTargetSelectionSchema,
    preflightHash: workflowHashSchema.nullable(),
    targetProgress: workflowTargetProgressSchema,
    result: workflowJsonValueSchema.nullable(),
    lastError: workflowExecutionErrorSchema.nullable(),
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  }),
);
export const mailWorkflowRunTargetSchema = responseSchema<MailWorkflowRunTarget>()(
  z.object({
    id: z.string().uuid(),
    parentRunId: z.string().uuid(),
    ordinal: z.number().int().nonnegative(),
    targetKey: z.string(),
    state: workflowTargetStateSchema,
    executionGeneration: z.number().int().nonnegative(),
    inputs: workflowJsonObjectSchema,
    source: workflowJsonValueSchema,
    preconditions: workflowJsonValueSchema,
    result: workflowJsonValueSchema.nullable(),
    lastError: workflowExecutionErrorSchema.nullable(),
    cancelRequestedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  }),
);

const errorResponses = {
  400: jsonResponse(ErrorResponseSchema, "Invalid request"),
  401: jsonResponse(ErrorResponseSchema, "Authentication required"),
  403: jsonResponse(ErrorResponseSchema, "Forbidden"),
  404: jsonResponse(ErrorResponseSchema, "Not found"),
  409: jsonResponse(ErrorResponseSchema, "Conflict"),
  500: jsonResponse(ErrorResponseSchema, "Internal server error"),
};
type ErrorStatus = keyof typeof errorResponses;

export const workflowOperation = <T extends z.ZodType>(
  summary: string,
  successSchema: T,
  successDescription: string,
  additionalErrors: readonly Exclude<ErrorStatus, 400 | 401 | 403 | 500>[] = [],
) =>
  describeRoute({
    tags: ["Mail:Workflows"],
    summary,
    ...requiresAuth,
    responses: {
      200: jsonResponse(successSchema, successDescription),
      400: errorResponses[400],
      401: errorResponses[401],
      403: errorResponses[403],
      500: errorResponses[500],
      ...Object.fromEntries(additionalErrors.map((status) => [status, errorResponses[status]])),
    },
  });
