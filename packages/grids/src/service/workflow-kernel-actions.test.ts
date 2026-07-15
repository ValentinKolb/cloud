import { describe, expect, mock, test } from "bun:test";
import type { WorkflowBoundPlan, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import type {
  WorkflowActionStep,
  WorkflowDryRunActionContext,
  WorkflowExecuteActionContext,
  WorkflowVariableScope,
} from "@valentinkolb/cloud/workflows/runtime";
import type { EmailTemplate, GridRecord, Table } from "../contracts";
import { createGridsWorkflowActionPorts, type GridsWorkflowEffectIntentPort, gridsWorkflowActionEffect } from "./workflow-kernel-actions";

const BASE_ID = "00000000-0000-4000-8000-000000000001";
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const TABLE_ID = "00000000-0000-4000-8000-000000000004";
const RECORD_ID = "00000000-0000-4000-8000-000000000005";
const FIELD_ID = "00000000-0000-4000-8000-000000000006";
const TEMPLATE_ID = "00000000-0000-4000-8000-000000000007";

const workflow = { id: WORKFLOW_ID, shortId: "abcde", baseId: BASE_ID, name: "Conformance" };
const table = { id: TABLE_ID, baseId: BASE_ID } as Table;
const record: GridRecord = {
  id: RECORD_ID,
  tableId: TABLE_ID,
  data: { [FIELD_ID]: "Ada" },
  version: 1,
  deletedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z",
};
const emailTemplate = { id: TEMPLATE_ID, baseId: BASE_ID, enabled: true, name: "Notice" } as EmailTemplate;

class Variables implements WorkflowVariableScope {
  readonly values = new Map<string, WorkflowJsonValue>();

  get(name: string): WorkflowJsonValue | undefined {
    return this.values.get(name);
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  set(name: string, value: WorkflowJsonValue): void {
    this.values.set(name, value);
  }
}

const boundPlan = (bindings: Record<string, WorkflowJsonValue> = {}): WorkflowBoundPlan =>
  ({
    schemaVersion: 1,
    languageId: "grids",
    languageVersion: 1,
    sourceHash: "source",
    manifestHash: "manifest",
    catalogHash: "catalog",
    inputs: [],
    triggers: [],
    steps: [],
    bindings,
  }) as WorkflowBoundPlan;

const actionStep = (
  action: string,
  config: Record<string, WorkflowJsonValue>,
  sourcePath: Array<string | number> = ["steps", 0],
): WorkflowActionStep => ({ kind: "action", action, config, sourcePath });

type ContextOptions = {
  plan?: WorkflowBoundPlan;
  references?: Record<string, WorkflowJsonValue>;
  evaluate?: (value: WorkflowJsonValue, path?: Array<string | number>) => Promise<WorkflowJsonValue>;
  resolveReference?: (reference: string, path?: Array<string | number>) => Promise<WorkflowJsonValue | undefined>;
};

const context = <Mode extends "execute" | "dryRun">(
  mode: Mode,
  step: WorkflowActionStep,
  options: ContextOptions = {},
): {
  value: Mode extends "execute" ? WorkflowExecuteActionContext : WorkflowDryRunActionContext;
  variables: Variables;
  heartbeat: ReturnType<typeof mock>;
} => {
  const variables = new Variables();
  const heartbeat = mock(async () => undefined);
  const invocation = {
    workflowId: WORKFLOW_ID,
    mode,
    channel: "manual",
    actor: { userId: "00000000-0000-4000-8000-000000000008", groupIds: [] },
    inputs: {},
    idempotencyKey: "invocation",
    occurredAt: "2026-07-14T12:00:00.000Z",
  } as const;
  const runtimeStep = {
    runId: RUN_ID,
    executionGeneration: 1,
    mode,
    workflowId: WORKFLOW_ID,
    sourceHash: "source",
    idempotencyKey: "invocation",
    key: step.sourcePath.join("."),
    sourcePath: step.sourcePath,
    iterationPath: [],
    path: step.sourcePath,
    kind: "action" as const,
    action: step.action,
  };
  const value = {
    mode,
    run: {
      runId: RUN_ID,
      executionGeneration: 1,
      mode,
      workflowId: WORKFLOW_ID,
      sourceHash: "source",
      idempotencyKey: "invocation",
    },
    step: runtimeStep,
    plan: options.plan ?? boundPlan(),
    invocation,
    variables,
    evaluate: options.evaluate ?? (async (raw) => raw),
    resolveReference: options.resolveReference ?? (async (reference) => (options.references ?? {})[reference]),
    heartbeat,
  };
  return {
    value: value as unknown as Mode extends "execute" ? WorkflowExecuteActionContext : WorkflowDryRunActionContext,
    variables,
    heartbeat,
  };
};

const executingIntents = (): GridsWorkflowEffectIntentPort => ({
  prepare: mock(async () => ({ state: "execute" as const })),
  executeTransactional: mock(async (_input, perform) => {
    const output = await perform({} as never);
    return { state: "succeeded" as const, ...(output === undefined ? {} : { output }) };
  }),
  succeed: mock(async () => undefined),
  fail: mock(async () => undefined),
  needsAttention: mock(async () => undefined),
});

const commonServices = () => ({
  audit: mock(async () => undefined),
  requirePermission: mock(async () => true),
  getTable: mock(async () => table),
  getRecord: mock(async () => record),
});

describe("Grids workflow kernel action ports", () => {
  test("registers exactly the manifest action set and classifications", () => {
    const ports = createGridsWorkflowActionPorts({ workflow, services: commonServices(), effectIntents: executingIntents() });
    const expected = {
      updateRecord: "transactional",
      createRecord: "transactional",
      generateDocument: "durable-intent",
      createDocumentLink: "transactional",
      sendEmail: "durable-intent",
      httpRequest: "ambiguous-external",
      setVariable: "pure",
      fail: "pure",
      succeed: "pure",
    } as const;
    for (const [action, effect] of Object.entries(expected)) {
      expect(ports.execute.get(action)).toBeDefined();
      expect(ports.dryRun.get(action)).toBeDefined();
      expect(gridsWorkflowActionEffect(action)).toBe(effect);
    }
    expect(ports.execute.get("unknown")).toBeUndefined();
    expect(ports.dryRun.get("unknown")).toBeUndefined();
  });

  test("awaits record resolution and field evaluation with exact binder paths", async () => {
    const update = mock(async () => ({ ok: true as const, data: record }));
    const paths: Array<{ kind: string; path: Array<string | number> | undefined }> = [];
    const services = { ...commonServices(), updateRecord: update };
    const ports = createGridsWorkflowActionPorts({ workflow, services, effectIntents: executingIntents() });
    const step = actionStep("updateRecord", { record: "inputs.item", set: { Status: "Done" } });
    const ctx = context("execute", step, {
      plan: boundPlan({ "steps.0.updateRecord.set.Status": FIELD_ID }),
      resolveReference: async (_reference, path) => {
        await Promise.resolve();
        paths.push({ kind: "resolve", path });
        return { kind: "record", tableId: TABLE_ID, recordId: RECORD_ID };
      },
      evaluate: async (value, path) => {
        await Promise.resolve();
        paths.push({ kind: "evaluate", path });
        return value;
      },
    }).value;

    const outcome = await ports.execute.get("updateRecord")!.execute(ctx, step);

    expect(outcome.state).toBe("completed");
    expect(paths).toEqual([
      { kind: "resolve", path: ["steps", 0, "updateRecord", "record"] },
      { kind: "evaluate", path: ["steps", 0, "updateRecord", "set", "Status"] },
    ]);
    expect(update).toHaveBeenCalledWith(TABLE_ID, RECORD_ID, { [FIELD_ID]: "Done" }, ctx.invocation.actor.userId, expect.anything());
  });

  test("uses persisted dashboard authorization while retaining target permission checks", async () => {
    const authorizeExecution = mock(async () => true);
    const requirePermission = mock(
      async (input: { target: { workflowId?: string; tableId?: string } }) => input.target.tableId === TABLE_ID,
    );
    const update = mock(async () => ({ ok: true as const, data: record }));
    const ports = createGridsWorkflowActionPorts({
      workflow,
      authorizeExecution,
      services: { ...commonServices(), requirePermission, updateRecord: update },
      effectIntents: executingIntents(),
    });
    const step = actionStep("updateRecord", { record: "inputs.item", set: { Status: "Done" } });
    const ctx = context("execute", step, {
      plan: boundPlan({ "steps.0.updateRecord.set.Status": FIELD_ID }),
      references: { "inputs.item": { kind: "record", tableId: TABLE_ID, recordId: RECORD_ID } },
    }).value;

    const outcome = await ports.execute.get("updateRecord")!.execute(ctx, step);

    expect(outcome.state).toBe("completed");
    expect(authorizeExecution).toHaveBeenCalledTimes(1);
    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        baseId: BASE_ID,
        actor: ctx.invocation.actor,
        target: { tableId: TABLE_ID },
        required: "write",
      }),
    );
    expect(requirePermission.mock.calls.some(([input]) => "workflowId" in input.target)).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test("dry-run validates reads but does not write, send, or create effect intents", async () => {
    const create = mock(async () => ({ ok: true as const, data: record }));
    const send = mock(async () => ({ ok: true as const, data: { recipients: [] } }));
    const intents = executingIntents();
    const ports = createGridsWorkflowActionPorts({
      workflow,
      services: {
        ...commonServices(),
        createRecord: create,
        getEmailTemplate: mock(async () => emailTemplate),
        sendEmail: send,
      },
      effectIntents: intents,
    });
    const createStep = actionStep("createRecord", { table: "Items", values: { Name: "Ada" }, saveAs: "created" });
    const createCtx = context("dryRun", createStep, {
      plan: boundPlan({
        "steps.0.createRecord.table": TABLE_ID,
        "steps.0.createRecord.values.Name": FIELD_ID,
      }),
    });
    const emailStep = actionStep("sendEmail", { template: "Notice", to: [{ email: "ada@example.test" }], saveAs: "delivery" }, [
      "steps",
      1,
    ]);
    const emailCtx = context("dryRun", emailStep, {
      plan: boundPlan({ "steps.1.sendEmail.template": TEMPLATE_ID }),
    });

    const createOutcome = await ports.dryRun.get("createRecord")!.plan(createCtx.value, createStep);
    const emailOutcome = await ports.dryRun.get("sendEmail")!.plan(emailCtx.value, emailStep);

    expect(createOutcome).toMatchObject({ state: "planned", effects: [{ effect: "transactional" }] });
    expect(emailOutcome).toMatchObject({ state: "planned", effects: [{ effect: "durable-intent" }] });
    expect(create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(intents.prepare).not.toHaveBeenCalled();
    expect(intents.executeTransactional).not.toHaveBeenCalled();
    expect(createCtx.variables.get("created")).toMatchObject({ kind: "record", tableId: TABLE_ID, planned: true });
  });

  test("does not blindly retry an intent whose external outcome is unknown", async () => {
    const send = mock(async () => ({ ok: true as const, data: { recipients: [] } }));
    const prepare = mock(async () => ({
      state: "needs_attention" as const,
      error: { code: "WORKFLOW_EFFECT_OUTCOME_UNKNOWN", message: "unknown", retryable: false },
    }));
    const intents: GridsWorkflowEffectIntentPort = {
      prepare,
      executeTransactional: mock(async () => ({
        state: "needs_attention" as const,
        error: { code: "WORKFLOW_EFFECT_OUTCOME_UNKNOWN", message: "unknown", retryable: false },
      })),
      succeed: mock(async () => undefined),
      fail: mock(async () => undefined),
      needsAttention: mock(async () => undefined),
    };
    const ports = createGridsWorkflowActionPorts({
      workflow,
      services: { ...commonServices(), getEmailTemplate: mock(async () => emailTemplate), sendEmail: send },
      effectIntents: intents,
    });
    const step = actionStep("sendEmail", { template: "Notice", to: [{ email: "ada@example.test" }], saveAs: "delivery" });
    const ctx = context("execute", step, { plan: boundPlan({ "steps.0.sendEmail.template": TEMPLATE_ID }) });

    const outcome = await ports.execute.get("sendEmail")!.execute(ctx.value, step);

    expect(outcome).toMatchObject({ state: "needs_attention", error: { code: "WORKFLOW_EFFECT_OUTCOME_UNKNOWN" } });
    expect(send).not.toHaveBeenCalled();
    expect((prepare.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
      runId: RUN_ID,
      stepKey: "steps.0",
      effectKind: "durable-intent",
      idempotencyKey: `workflow:${RUN_ID}:step:steps.0`,
    });
    expect(ctx.heartbeat).toHaveBeenCalledTimes(1);
  });

  test("marks an ambiguous HTTP transport outcome for operator attention", async () => {
    const intents = executingIntents();
    const ports = createGridsWorkflowActionPorts({
      workflow,
      services: {
        ...commonServices(),
        httpRequest: mock(async () => ({
          ok: false as const,
          error: {
            code: "WORKFLOW_HTTP_OUTCOME_UNKNOWN",
            message: "The request may have reached the remote service.",
            status: 500,
          },
        })),
      },
      effectIntents: intents,
    });
    const step = actionStep("httpRequest", { url: "https://api.example.test/hook", method: "POST" });
    const ctx = context("execute", step);

    const outcome = await ports.execute.get("httpRequest")!.execute(ctx.value, step);

    expect(outcome).toMatchObject({ state: "needs_attention", error: { code: "WORKFLOW_HTTP_OUTCOME_UNKNOWN" } });
    expect(intents.needsAttention).toHaveBeenCalledTimes(1);
    expect(intents.fail).not.toHaveBeenCalled();
  });

  test("restores saveAs variables from completed step output", async () => {
    const ports = createGridsWorkflowActionPorts({ workflow, services: commonServices(), effectIntents: executingIntents() });
    const step = actionStep("createRecord", { table: "Items", values: { Name: "Ada" }, saveAs: "created" });
    const ctx = context("execute", step);
    const output = { kind: "record", tableId: TABLE_ID, recordId: RECORD_ID } as const;

    await ports.execute.get("createRecord")!.restoreCompleted!(ctx.value, step, { state: "completed", output });

    expect(ctx.variables.get("created")).toEqual(output);
  });
});
