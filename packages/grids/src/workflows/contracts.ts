import type {
  WorkflowBoundPlan,
  WorkflowDiagnostic,
  WorkflowInvocationMode,
  WorkflowJsonValue,
  WorkflowRunState,
  WorkflowStepState,
} from "@valentinkolb/cloud/workflows";
import { z } from "zod";

export const GRIDS_WORKFLOW_CHANNELS = ["api", "dashboard", "scanner", "bulk", "schedule", "recordEvent"] as const;

export type GridsWorkflowChannel = (typeof GRIDS_WORKFLOW_CHANNELS)[number];

export const GridsWorkflowCredentialBindingSchema = z
  .object({
    appId: z.string().min(1),
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
  })
  .strict();

export type GridsWorkflowCredentialBinding = z.infer<typeof GridsWorkflowCredentialBindingSchema>;

export const GridsWorkflowCredentialSchema = z
  .object({
    kind: z.enum(["api_token", "oauth"]),
    id: z.string().uuid().nullable(),
    scopes: z.array(z.string()).max(500),
    permissionCap: z.enum(["none", "read", "write", "admin"]),
    expiresAt: z.string().datetime().nullable(),
    resourceBinding: GridsWorkflowCredentialBindingSchema.nullable(),
  })
  .strict();

export type GridsWorkflowCredential = z.infer<typeof GridsWorkflowCredentialSchema>;

export type GridsWorkflowPrincipal = {
  userId: string | null;
  /** Legacy projection only. Authorization resolves current recursive memberships from userId. */
  groupIds: string[];
  serviceAccountId: string | null;
  /** The authenticating service account, including delegated-user credentials. */
  actorServiceAccountId?: string | null;
  credential?: GridsWorkflowCredential | null;
};

export const GridsWorkflowPrincipalSchema = z
  .object({
    userId: z.string().uuid().nullable(),
    groupIds: z.array(z.string().uuid()).max(10_000),
    serviceAccountId: z.string().uuid().nullable(),
    actorServiceAccountId: z.string().uuid().nullable().default(null),
    credential: GridsWorkflowCredentialSchema.nullable().default(null),
  })
  .strict();

export const WORKFLOW_REVISION_HEADER = "X-Workflow-Revision";

export const GRIDS_WORKFLOW_LAUNCHER_KINDS = ["scanner", "bulk", "dashboard"] as const;

export type GridsWorkflowLauncherKind = (typeof GRIDS_WORKFLOW_LAUNCHER_KINDS)[number];

export type GridsWorkflow = {
  id: string;
  shortId: string;
  baseId: string;
  name: string;
  description: string | null;
  source: string;
  plan: WorkflowBoundPlan;
  diagnostics: WorkflowDiagnostic[];
  enabled: boolean;
  position: number;
  revision: number;
  ownerUserId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateGridsWorkflowInput = {
  name: string;
  description?: string | null;
  source: string;
  enabled?: boolean;
  position?: number;
};

export type UpdateGridsWorkflowInput = Partial<CreateGridsWorkflowInput>;

export type GridsWorkflowLauncherConfig =
  | {
      kind: "scanner";
      input: string;
      resolve: { by: "scanCode" | "field"; field?: string };
    }
  | { kind: "bulk"; input: string }
  | { kind: "dashboard"; label?: string; inputBindings?: Record<string, WorkflowJsonValue> };

export type GridsWorkflowLauncher = {
  id: string;
  shortId: string;
  baseId: string;
  workflowId: string;
  name: string;
  config: GridsWorkflowLauncherConfig;
  enabled: boolean;
  validatedRevision: number;
  diagnostics: WorkflowDiagnostic[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateGridsWorkflowLauncherInput = {
  name: string;
  config: GridsWorkflowLauncherConfig;
  enabled?: boolean;
};

export type UpdateGridsWorkflowLauncherInput = Partial<CreateGridsWorkflowLauncherInput>;

export type GridsWorkflowInvocationRequest = {
  mode: WorkflowInvocationMode;
  inputs: Record<string, WorkflowJsonValue>;
  idempotencyKey: string;
  expectedRevision?: number;
};

export type GridsWorkflowRun = {
  id: string;
  workflowId: string | null;
  launcherId: string | null;
  baseId: string;
  workflowRevision: number;
  mode: WorkflowInvocationMode;
  channel: GridsWorkflowChannel;
  actorUserId: string | null;
  serviceAccountId: string | null;
  inputs: Record<string, WorkflowJsonValue>;
  status: WorkflowRunState;
  result: WorkflowJsonValue | null;
  error: { code: string; message: string; retryable: boolean; details?: Record<string, WorkflowJsonValue> } | null;
  resultMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type GridsWorkflowStepRun = {
  id: string;
  runId: string;
  key: string;
  sourcePath: Array<string | number>;
  iterationPath: number[];
  kind: string;
  action: string | null;
  status: WorkflowStepState | "waiting" | "needs_attention" | "unsupported";
  outcome: WorkflowJsonValue | null;
  executionGeneration: number;
  startedAt: string | null;
  finishedAt: string | null;
};

export const WorkflowDiagnosticSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
  path: z.array(z.union([z.string(), z.number()])),
  location: z
    .object({ offset: z.number().int().nonnegative(), line: z.number().int().positive(), column: z.number().int().positive() })
    .optional(),
});

export const WorkflowPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    languageId: z.string(),
    languageVersion: z.number().int().positive(),
    sourceHash: z.string(),
    manifestHash: z.string(),
    catalogHash: z.string(),
    maxLoopItems: z.number().int().positive().optional(),
    inputs: z.array(z.unknown()),
    triggers: z.array(z.unknown()),
    steps: z.array(z.unknown()),
    bindings: z.record(z.string(), z.unknown()),
  })
  .strict()
  .transform((value) => value as WorkflowBoundPlan);

export const GridsWorkflowSchema = z.object({
  id: z.string().uuid(),
  shortId: z.string().length(5),
  baseId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  source: z.string(),
  plan: WorkflowPlanSchema,
  diagnostics: z.array(WorkflowDiagnosticSchema),
  enabled: z.boolean(),
  position: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  ownerUserId: z.string().uuid().nullable(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CreateGridsWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  source: z.string().min(1).max(200_000),
  enabled: z.boolean().optional(),
  position: z.number().int().nonnegative().optional(),
});

export const UpdateGridsWorkflowSchema = CreateGridsWorkflowSchema.partial();

const ScannerLauncherConfigSchema = z
  .object({
    kind: z.literal("scanner"),
    input: z.string().trim().min(1).max(120),
    resolve: z
      .object({
        by: z.enum(["scanCode", "field"]),
        field: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.resolve.by === "field" && !config.resolve.field) {
      ctx.addIssue({ code: "custom", path: ["resolve", "field"], message: "field resolution requires a field" });
    }
    if (config.resolve.by === "scanCode" && config.resolve.field !== undefined) {
      ctx.addIssue({ code: "custom", path: ["resolve", "field"], message: "scan-code resolution does not accept a field" });
    }
  });

const BulkLauncherConfigSchema = z
  .object({
    kind: z.literal("bulk"),
    input: z.string().trim().min(1).max(120),
  })
  .strict();

const DashboardLauncherConfigSchema = z
  .object({
    kind: z.literal("dashboard"),
    label: z.string().trim().min(1).max(80).optional(),
    inputBindings: z.record(z.string(), z.json()).optional(),
  })
  .strict();

export const GridsWorkflowLauncherConfigSchema = z.discriminatedUnion("kind", [
  ScannerLauncherConfigSchema,
  BulkLauncherConfigSchema,
  DashboardLauncherConfigSchema,
]);

export const CreateGridsWorkflowLauncherSchema = z.object({
  name: z.string().trim().min(1).max(200),
  config: GridsWorkflowLauncherConfigSchema,
  enabled: z.boolean().optional(),
});

export const UpdateGridsWorkflowLauncherSchema = CreateGridsWorkflowLauncherSchema.partial();

export const GridsWorkflowInvocationRequestSchema = z
  .object({
    mode: z.enum(["execute", "dryRun"]).default("execute"),
    inputs: z.record(z.string(), z.json()).default({}),
    idempotencyKey: z.string().trim().min(1).max(200),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();

export const GridsWorkflowRunStatusSchema = z.enum(["queued", "running", "waiting", "succeeded", "failed", "canceled", "needs_attention"]);

export const GridsWorkflowListSchema = z.array(GridsWorkflowSchema);

export const GridsWorkflowLauncherSchema = z.object({
  id: z.string().uuid(),
  shortId: z.string().length(5),
  baseId: z.string().uuid(),
  workflowId: z.string().uuid(),
  name: z.string(),
  config: GridsWorkflowLauncherConfigSchema,
  enabled: z.boolean(),
  validatedRevision: z.number().int().positive(),
  diagnostics: z.array(WorkflowDiagnosticSchema),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const GridsWorkflowLauncherListSchema = z.object({ items: z.array(GridsWorkflowLauncherSchema) });

export const WorkflowInvocationReceiptSchema = z.object({
  runId: z.string().uuid(),
  workflowId: z.string().uuid(),
  revision: z.number().int().positive(),
  mode: z.enum(["execute", "dryRun"]),
  channel: z.enum(GRIDS_WORKFLOW_CHANNELS),
  created: z.boolean(),
  status: GridsWorkflowRunStatusSchema,
});

export const GridsWorkflowRunSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid().nullable(),
  launcherId: z.string().uuid().nullable(),
  baseId: z.string().uuid(),
  workflowRevision: z.number().int().positive(),
  mode: z.enum(["execute", "dryRun"]),
  channel: z.enum(GRIDS_WORKFLOW_CHANNELS),
  actorUserId: z.string().uuid().nullable(),
  serviceAccountId: z.string().uuid().nullable(),
  inputs: z.record(z.string(), z.json()),
  status: GridsWorkflowRunStatusSchema,
  result: z.json().nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
      details: z.record(z.string(), z.json()).optional(),
    })
    .nullable(),
  resultMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});

export const GridsWorkflowRunListSchema = z.object({
  items: z.array(GridsWorkflowRunSchema),
  nextCursor: z.string().nullable(),
});

export const GridsWorkflowStepRunSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  key: z.string(),
  sourcePath: z.array(z.union([z.string(), z.number()])),
  iterationPath: z.array(z.number().int().nonnegative()),
  kind: z.string(),
  action: z.string().nullable(),
  status: z.enum([
    "queued",
    "running",
    "waiting",
    "succeeded",
    "failed",
    "canceled",
    "needs_attention",
    "unsupported",
    "indeterminate",
    "skipped",
  ]),
  outcome: z.json().nullable(),
  executionGeneration: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});

export const GridsWorkflowStepRunListSchema = z.object({ items: z.array(GridsWorkflowStepRunSchema) });

export const GridsWorkflowEmailDeliverySchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid().nullable(),
  workflowRunId: z.string().uuid().nullable(),
  templateId: z.string().uuid().nullable(),
  subject: z.string().nullable(),
  recipients: z.array(
    z.object({
      kind: z.enum(["email", "user"]),
      recipient: z.string(),
      notificationId: z.string().uuid().optional(),
      status: z.string().optional(),
    }),
  ),
  status: z.enum(["pending", "sent", "failed"]),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type GridsWorkflowEmailDelivery = z.infer<typeof GridsWorkflowEmailDeliverySchema>;

export const GridsWorkflowEmailDeliveryListSchema = z.object({
  items: z.array(GridsWorkflowEmailDeliverySchema),
  nextCursor: z.string().nullable(),
});

export const GridsWorkflowRunStatsWindowSchema = z.enum(["10m", "1h", "12h", "24h", "7d", "30d"]);
export type GridsWorkflowRunStatsWindow = z.infer<typeof GridsWorkflowRunStatsWindowSchema>;

const GridsWorkflowRunStatsCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
  needsAttention: z.number().int().nonnegative(),
  errorRate: z.number().nonnegative(),
  avgDurationMs: z.number().int().nonnegative().nullable(),
  p99DurationMs: z.number().int().nonnegative().nullable(),
  lastRunAt: z.string().datetime().nullable(),
});

export const GridsWorkflowRunStatsSchema = GridsWorkflowRunStatsCountsSchema.extend({
  window: GridsWorkflowRunStatsWindowSchema,
  failedLast24h: z.number().int().nonnegative(),
  byWorkflow: z.array(
    GridsWorkflowRunStatsCountsSchema.extend({
      workflowId: z.string().uuid(),
      latestStatus: GridsWorkflowRunStatusSchema.nullable(),
    }),
  ),
});

export type GridsWorkflowRunStats = z.infer<typeof GridsWorkflowRunStatsSchema>;

export const WorkflowAutocompleteBodySchema = z
  .object({
    source: z.string().max(200_000),
    caret: z.number().int().min(0).max(200_000).optional(),
  })
  .refine((body) => body.caret === undefined || body.caret <= body.source.length, {
    message: "caret must be inside source",
    path: ["caret"],
  });

const WorkflowCompletionItemSchema = z.object({
  label: z.string(),
  kind: z.enum(["keyword", "source", "field", "literal"]),
  detail: z.string().optional(),
  insertText: z.string(),
  textEdit: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), text: z.string() }),
  commitCharacters: z.array(z.string()).optional(),
});

export type WorkflowCompletionItem = z.infer<typeof WorkflowCompletionItemSchema>;

export const WorkflowAutocompleteResponseSchema = z.object({
  ok: z.literal(true),
  diagnostics: z.array(WorkflowDiagnosticSchema),
  items: z.array(WorkflowCompletionItemSchema),
});

export type WorkflowAutocompleteResponse = z.infer<typeof WorkflowAutocompleteResponseSchema>;
