export type WorkflowJsonPrimitive = string | number | boolean | null;
export type WorkflowJsonValue = WorkflowJsonPrimitive | WorkflowJsonValue[] | { [key: string]: WorkflowJsonValue };

export type WorkflowSourceLocation = {
  offset: number;
  line: number;
  column: number;
};

export type WorkflowDiagnostic = {
  code: string;
  message: string;
  severity: "error" | "warning";
  path: Array<string | number>;
  location?: WorkflowSourceLocation;
};

type WorkflowSchemaBase = {
  optional?: boolean;
  description?: string;
};

export type WorkflowFieldSchema =
  | (WorkflowSchemaBase & {
      kind: "string";
      enum?: string[];
      minLength?: number;
      maxLength?: number;
      format?: "identifier" | "uri";
    })
  | (WorkflowSchemaBase & {
      kind: "number";
      integer?: boolean;
      minimum?: number;
      maximum?: number;
    })
  | (WorkflowSchemaBase & { kind: "boolean" })
  | (WorkflowSchemaBase & { kind: "value" })
  | (WorkflowSchemaBase & { kind: "array"; items: WorkflowFieldSchema; minItems?: number; maxItems?: number })
  | (WorkflowSchemaBase & {
      kind: "record";
      values: WorkflowFieldSchema;
      minProperties?: number;
      maxProperties?: number;
    })
  | (WorkflowSchemaBase & { kind: "object"; properties: Record<string, WorkflowFieldSchema> })
  | (WorkflowSchemaBase & { kind: "union"; variants: WorkflowFieldSchema[] });

export type WorkflowDescriptorDocs = {
  label: string;
  description: string;
  snippet?: string;
};

export type WorkflowInputDescriptor = WorkflowDescriptorDocs & {
  kind: string;
  config: WorkflowFieldSchema & { kind: "object" };
  valueType: string;
};

export type WorkflowTriggerDescriptor = WorkflowDescriptorDocs & {
  kind: string;
  config: WorkflowFieldSchema & { kind: "object" };
  eventValues: Record<string, string>;
};

export type WorkflowActionEffect = "pure" | "transactional" | "durable-intent" | "ambiguous-external";

export type WorkflowActionDescriptor = WorkflowDescriptorDocs & {
  kind: string;
  config: WorkflowFieldSchema & { kind: "object" };
  effect: WorkflowActionEffect;
  outputType?: string;
  dryRun: "full" | "validate" | "unsupported";
};

export type WorkflowLanguageManifest = {
  id: string;
  version: number;
  inputs: WorkflowInputDescriptor[];
  triggers: WorkflowTriggerDescriptor[];
  actions: WorkflowActionDescriptor[];
  limits?: {
    maxInputs?: number;
    maxSteps?: number;
    maxDepth?: number;
    maxLoopItems?: number;
  };
};

export type WorkflowIrInput = {
  name: string;
  type: string;
  config: Record<string, WorkflowJsonValue>;
};

export type WorkflowIrTrigger = {
  kind: string;
  config: Record<string, WorkflowJsonValue>;
  with: Record<string, WorkflowJsonValue>;
};

export type WorkflowCondition =
  | { operator: "equals" | "notEquals"; operands: [WorkflowJsonValue, WorkflowJsonValue] }
  | { operator: "exists"; reference: string };

export type WorkflowIrStep =
  | { kind: "action"; action: string; config: Record<string, WorkflowJsonValue>; sourcePath: Array<string | number> }
  | {
      kind: "if";
      condition: WorkflowCondition;
      then: WorkflowIrStep[];
      else: WorkflowIrStep[];
      sourcePath: Array<string | number>;
    }
  | {
      kind: "switch";
      value: WorkflowJsonValue;
      cases: Array<{ when: WorkflowJsonValue; steps: WorkflowIrStep[] }>;
      default: WorkflowIrStep[];
      sourcePath: Array<string | number>;
    }
  | {
      kind: "forEach";
      reference: string;
      alias: string;
      steps: WorkflowIrStep[];
      sourcePath: Array<string | number>;
    };

export type WorkflowIr = {
  schemaVersion: 1;
  languageId: string;
  languageVersion: number;
  sourceHash: string;
  inputs: WorkflowIrInput[];
  triggers: WorkflowIrTrigger[];
  steps: WorkflowIrStep[];
  sourceLocations: Record<string, WorkflowSourceLocation>;
};

export type WorkflowBoundPlan = {
  schemaVersion: 1;
  languageId: string;
  languageVersion: number;
  sourceHash: string;
  manifestHash: string;
  catalogHash: string;
  inputs: WorkflowIrInput[];
  triggers: WorkflowIrTrigger[];
  steps: WorkflowIrStep[];
  bindings: Record<string, WorkflowJsonValue>;
};

export type WorkflowActor = {
  userId?: string | null;
  serviceAccountId?: string | null;
  groupIds?: string[];
};

export type WorkflowInvocationMode = "execute" | "dryRun";

export type WorkflowInvocation<Channel extends string = string> = {
  workflowId: string;
  expectedRevision?: number;
  mode: WorkflowInvocationMode;
  channel: Channel;
  actor: WorkflowActor;
  inputs: Record<string, WorkflowJsonValue>;
  idempotencyKey: string;
  occurredAt: string;
  context?: Record<string, WorkflowJsonValue>;
};

export type WorkflowLauncher<Config extends WorkflowJsonValue = WorkflowJsonValue> = {
  id: string;
  workflowId: string;
  kind: string;
  name: string;
  enabled: boolean;
  config: Config;
  validatedRevision?: number;
  diagnostics: WorkflowDiagnostic[];
};

export type WorkflowInvocationReceipt = {
  runId: string;
  workflowId: string;
  revision: number;
  mode: WorkflowInvocationMode;
  channel: string;
  created: boolean;
  status: WorkflowRunState;
};

export type WorkflowStepState = "queued" | "running" | "waiting" | "succeeded" | "failed" | "skipped" | "indeterminate";
export type WorkflowRunState = "queued" | "running" | "waiting" | "succeeded" | "failed" | "canceled" | "needs_attention";

export type WorkflowExecutionError = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, WorkflowJsonValue>;
};

export type WorkflowDependency = {
  kind: string;
  key: string;
  deadline?: string;
  data?: Record<string, WorkflowJsonValue>;
};

export type WorkflowStepOutcome =
  | { state: "completed"; output?: WorkflowJsonValue }
  | { state: "waiting"; dependency: WorkflowDependency }
  | { state: "failed"; error: WorkflowExecutionError }
  | { state: "needs_attention"; error: WorkflowExecutionError }
  | { state: "terminal"; status: "succeeded" | "canceled"; message?: string };

export type WorkflowPlanningOutcome =
  | { state: "planned"; output?: WorkflowJsonValue; effects: WorkflowJsonValue[] }
  | { state: "terminal"; status: "succeeded" | "failed"; message?: string; effects: WorkflowJsonValue[] }
  | { state: "unsupported"; reason: string }
  | { state: "indeterminate"; reason: string };

export const workflowPathKey = (path: Array<string | number>): string => path.map(String).join(".");
