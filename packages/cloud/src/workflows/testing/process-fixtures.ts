import type { WorkflowInvocation, WorkflowJsonValue, WorkflowLanguageManifest, WorkflowLauncher } from "../contracts";

const docs = { label: "Process fixture", description: "Framework-neutral workflow conformance fixture" };

export const workflowProcessManifest: WorkflowLanguageManifest = {
  id: "workflow-process-fixtures",
  version: 1,
  inputs: [
    {
      ...docs,
      kind: "text",
      valueType: "string",
      config: {
        kind: "object",
        properties: { required: { kind: "boolean", optional: true } },
      },
    },
    {
      ...docs,
      kind: "record",
      valueType: "record",
      config: {
        kind: "object",
        properties: {
          resource: { kind: "string", format: "identifier" },
          required: { kind: "boolean", optional: true },
        },
      },
    },
    {
      ...docs,
      kind: "recordList",
      valueType: "record[]",
      config: {
        kind: "object",
        properties: {
          resource: { kind: "string", format: "identifier" },
          maxItems: { kind: "number", integer: true, minimum: 1, optional: true },
          required: { kind: "boolean", optional: true },
        },
      },
    },
  ],
  triggers: [
    {
      ...docs,
      kind: "schedule",
      eventValues: { occurredAt: "dateTime" },
      config: {
        kind: "object",
        properties: {
          cron: { kind: "string", minLength: 1 },
          timezone: { kind: "string", minLength: 1 },
        },
      },
    },
    {
      ...docs,
      kind: "recordEvent",
      eventValues: { event: "string", record: "record" },
      config: {
        kind: "object",
        properties: {
          event: { kind: "string", enum: ["created", "updated", "deleted"] },
          resource: { kind: "string", format: "identifier" },
        },
      },
    },
  ],
  actions: [
    {
      ...docs,
      kind: "capture",
      effect: "pure",
      dryRun: "full",
      outputType: "value",
      config: {
        kind: "object",
        properties: { value: { kind: "value" } },
      },
    },
  ],
  limits: { maxInputs: 4, maxSteps: 10, maxDepth: 3, maxLoopItems: 100 },
};

export type WorkflowProcessFixture = {
  id: string;
  workflowId: string;
  source: string;
  catalog: WorkflowJsonValue;
  bindings: Record<string, WorkflowJsonValue>;
  invocation: WorkflowInvocation & { mode: "execute" };
  launchers: WorkflowLauncher[];
  expectedOutput: WorkflowJsonValue;
};

const processInvocation = (
  workflowId: string,
  channel: string,
  inputs: Record<string, WorkflowJsonValue>,
): WorkflowInvocation & { mode: "execute" } => ({
  workflowId,
  mode: "execute",
  channel,
  actor: { userId: "fixture-user" },
  inputs,
  idempotencyKey: `${workflowId}:${channel}:fixture`,
  occurredAt: "2026-07-14T08:00:00.000Z",
});

const resourceCatalog = {
  revision: 1,
  resources: { items: { id: "resource-items", kind: "record" } },
};

export const directOnlyProcessFixture: WorkflowProcessFixture = {
  id: "direct-only",
  workflowId: "fixture-direct-only",
  source: `inputs:
  message:
    type: text
    required: true
steps:
  - capture:
      value: "\${{ inputs.message }}"
`,
  catalog: { revision: 1 },
  bindings: {},
  invocation: processInvocation("fixture-direct-only", "api", { message: "manual input" }),
  launchers: [],
  expectedOutput: "manual input",
};

export const scheduleProcessFixture: WorkflowProcessFixture = {
  id: "schedule-bindings",
  workflowId: "fixture-schedule",
  source: `inputs:
  runAt:
    type: text
    required: true
triggers:
  schedule:
    cron: "0 8 * * *"
    timezone: Europe/Berlin
    with:
      runAt: "\${{ trigger.occurredAt }}"
steps:
  - capture:
      value: "\${{ inputs.runAt }}"
`,
  catalog: { revision: 1 },
  bindings: { schedule: "weekday-morning" },
  invocation: processInvocation("fixture-schedule", "schedule", { runAt: "2026-07-14T08:00:00.000Z" }),
  launchers: [],
  expectedOutput: "2026-07-14T08:00:00.000Z",
};

export const recordEventProcessFixture: WorkflowProcessFixture = {
  id: "record-event-bindings",
  workflowId: "fixture-record-event",
  source: `inputs:
  record:
    type: record
    resource: items
    required: true
triggers:
  recordEvent:
    event: updated
    resource: items
    with:
      record: "\${{ trigger.record }}"
steps:
  - capture:
      value: "\${{ inputs.record }}"
`,
  catalog: resourceCatalog,
  bindings: { resource: "resource-items" },
  invocation: processInvocation("fixture-record-event", "event", {
    record: { id: "record-1", resourceId: "resource-items" },
  }),
  launchers: [],
  expectedOutput: { id: "record-1", resourceId: "resource-items" },
};

export const scannerLauncherProcessFixture: WorkflowProcessFixture = {
  id: "scanner-launcher",
  workflowId: "fixture-scanner",
  source: `inputs:
  record:
    type: record
    resource: items
    required: true
steps:
  - capture:
      value: "\${{ inputs.record }}"
`,
  catalog: resourceCatalog,
  bindings: { resource: "resource-items" },
  invocation: processInvocation("fixture-scanner", "scanner", {
    record: { id: "record-scanned", resourceId: "resource-items" },
  }),
  launchers: [
    {
      id: "launcher-scanner",
      workflowId: "fixture-scanner",
      kind: "scanner",
      name: "Scan item",
      enabled: true,
      config: {
        input: "record",
        resolution: { kind: "stableCode", resource: "items" },
        processing: { maxPending: 4 },
      },
      validatedRevision: "3",
      diagnostics: [],
    },
  ],
  expectedOutput: { id: "record-scanned", resourceId: "resource-items" },
};

export const bulkLauncherProcessFixture: WorkflowProcessFixture = {
  id: "bulk-launcher",
  workflowId: "fixture-bulk",
  source: `inputs:
  records:
    type: recordList
    resource: items
    maxItems: 100
    required: true
steps:
  - capture:
      value: "\${{ inputs.records }}"
`,
  catalog: resourceCatalog,
  bindings: { resource: "resource-items" },
  invocation: processInvocation("fixture-bulk", "bulk", {
    records: [
      { id: "record-1", resourceId: "resource-items" },
      { id: "record-2", resourceId: "resource-items" },
    ],
  }),
  launchers: [
    {
      id: "launcher-bulk",
      workflowId: "fixture-bulk",
      kind: "bulk",
      name: "Process selection",
      enabled: true,
      config: {
        input: "records",
        selection: { resource: "items", maxItems: 100 },
      },
      validatedRevision: "5",
      diagnostics: [],
    },
  ],
  expectedOutput: [
    { id: "record-1", resourceId: "resource-items" },
    { id: "record-2", resourceId: "resource-items" },
  ],
};

export const workflowProcessFixtures: WorkflowProcessFixture[] = [
  directOnlyProcessFixture,
  scheduleProcessFixture,
  recordEventProcessFixture,
  scannerLauncherProcessFixture,
  bulkLauncherProcessFixture,
];
