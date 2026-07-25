import { describe, expect, mock, test } from "bun:test";
import type { WorkflowBoundPlan, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import type {
  WorkflowActionStep,
  WorkflowDryRunActionContext,
  WorkflowExecuteActionContext,
  WorkflowVariableScope,
} from "@valentinkolb/cloud/workflows/runtime";
import type { DocumentTemplate, EmailTemplate, GridRecord, Table } from "../contracts";
import {
  createGridsWorkflowActionPorts,
  type GridsWorkflowEffectIntentPort,
  gridsWorkflowActionEffect,
  gridsWorkflowActionScope,
} from "./workflow-kernel-actions";

const BASE_ID = "00000000-0000-4000-8000-000000000001";
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const TABLE_ID = "00000000-0000-4000-8000-000000000004";
const RECORD_ID = "00000000-0000-4000-8000-000000000005";
const FIELD_ID = "00000000-0000-4000-8000-000000000006";
const TEMPLATE_ID = "00000000-0000-4000-8000-000000000007";
const SERVICE_ACCOUNT_ID = "00000000-0000-4000-8000-000000000009";
const CREDENTIAL_ID = "00000000-0000-4000-8000-000000000010";
const TEST_DATE_CONTEXT = { timeZone: "UTC" } as const;

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
    schemaVersion: 2,
    languageId: "grids",
    languageVersion: 1,
    sourceHash: "source",
    manifestHash: "manifest",
    catalogHash: "catalog",
    actionPolicies: {},
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
  variables?: Variables;
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
  const variables = options.variables ?? new Variables();
  const heartbeat = mock(async () => undefined);
  const invocation = {
    workflowId: WORKFLOW_ID,
    mode,
    channel: "api",
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
  prepare: mock(async (input) => ({
    state: "execute" as const,
    runId: input.runId,
    idempotencyKey: input.idempotencyKey,
    executionGeneration: input.executionGeneration,
    attempt: 1,
  })),
  begin: mock(async (_claim, authorize) => authorize({} as never)),
  executeTransactional: mock(async (_input, perform) => {
    const output = await perform({} as never);
    return { state: "succeeded" as const, ...(output === undefined ? {} : { output }) };
  }),
  succeed: mock(async () => undefined),
  retry: mock(async () => undefined),
  fail: mock(async () => undefined),
  needsAttention: mock(async () => undefined),
});

const commonServices = () => ({
  audit: mock(async () => undefined),
  requirePermission: mock(async () => true),
  dateContext: mock(async () => TEST_DATE_CONTEXT),
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

  test("applies Grids execution authorization to shared built-ins", async () => {
    const authorizeExecution = mock(async () => false);
    const ports = createGridsWorkflowActionPorts({
      workflow,
      authorizeExecution,
      services: commonServices(),
      effectIntents: executingIntents(),
    });
    const action = actionStep("setVariable", { name: "result", value: true });
    const ctx = context("execute", action);

    const outcome = await ports.execute.get("setVariable")!.execute(ctx.value, action);

    expect(outcome).toMatchObject({ state: "failed", error: { code: "FORBIDDEN" } });
    expect(ctx.variables.has("result")).toBe(false);
    expect(authorizeExecution).toHaveBeenCalledTimes(1);
  });

  test("awaits record resolution and field evaluation with exact binder paths", async () => {
    const update = mock(async () => ({ ok: true as const, data: record }));
    const paths: Array<{ kind: string; path: Array<string | number> | undefined }> = [];
    const services = { ...commonServices(), updateRecord: update };
    const ports = createGridsWorkflowActionPorts({ workflow, services, effectIntents: executingIntents() });
    const auditQuestionId = "00000000-0000-4000-8000-000000000099";
    const step = actionStep("updateRecord", {
      record: "inputs.item",
      set: { Status: "Done" },
      audit: { [auditQuestionId]: "Scheduled lifecycle update" },
    });
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
      { kind: "evaluate", path: ["steps", 0, "updateRecord", "audit", auditQuestionId] },
    ]);
    expect(update).toHaveBeenCalledWith(
      TABLE_ID,
      RECORD_ID,
      { [FIELD_ID]: "Done" },
      { answers: { [auditQuestionId]: "Scheduled lifecycle update" } },
      ctx.invocation.actor.userId,
      expect.anything(),
      expect.anything(),
    );
  });

  test("resolves date context before opening record mutation transactions", async () => {
    const order: string[] = [];
    const dateConfig = { timeZone: "Europe/Berlin" } as const;
    const intents = executingIntents();
    intents.executeTransactional = mock(async (_input, perform) => {
      order.push("transaction");
      const output = await perform({} as never);
      return { state: "succeeded" as const, ...(output === undefined ? {} : { output }) };
    });
    const ports = createGridsWorkflowActionPorts({
      workflow,
      services: {
        ...commonServices(),
        dateContext: mock(async () => {
          order.push("dateContext");
          return dateConfig;
        }),
        updateRecord: mock(async (...args) => {
          order.push("updateRecord");
          expect(args[5]).toEqual(dateConfig);
          return { ok: true as const, data: record };
        }),
      },
      effectIntents: intents,
    });
    const step = actionStep("updateRecord", { record: "inputs.item", set: { Status: "Done" } });
    const ctx = context("execute", step, {
      plan: boundPlan({ "steps.0.updateRecord.set.Status": FIELD_ID }),
      references: { "inputs.item": { kind: "record", tableId: TABLE_ID, recordId: RECORD_ID } },
    }).value;

    const outcome = await ports.execute.get("updateRecord")!.execute(ctx, step);

    expect(outcome.state).toBe("completed");
    expect(order).toEqual(["dateContext", "transaction", "updateRecord"]);
  });

  test("stores only a fingerprint and field ids for record effect intent matching", async () => {
    let request: WorkflowJsonValue | undefined;
    const intents = executingIntents();
    intents.executeTransactional = mock(async (input, perform) => {
      request = input.request;
      const output = await perform({} as never);
      return { state: "succeeded" as const, ...(output === undefined ? {} : { output }) };
    });
    const ports = createGridsWorkflowActionPorts({
      workflow,
      services: {
        ...commonServices(),
        updateRecord: mock(async () => ({ ok: true as const, data: record })),
      },
      effectIntents: intents,
    });
    const step = actionStep("updateRecord", { record: "inputs.item", set: { Status: "customer-secret" } });
    const ctx = context("execute", step, {
      plan: boundPlan({ "steps.0.updateRecord.set.Status": FIELD_ID }),
      references: { "inputs.item": { kind: "record", tableId: TABLE_ID, recordId: RECORD_ID } },
    }).value;

    await ports.execute.get("updateRecord")!.execute(ctx, step);

    expect(request).toMatchObject({ action: "updateRecord", tableId: TABLE_ID, recordId: RECORD_ID, fieldIds: [FIELD_ID] });
    expect(request).toHaveProperty("requestFingerprint");
    expect(JSON.stringify(request)).not.toContain("customer-secret");
  });

  test("adds structured service-account credential provenance to effect audits", async () => {
    const audit = mock(async (_input: unknown) => undefined);
    const ports = createGridsWorkflowActionPorts({
      workflow,
      principal: {
        userId: null,
        groupIds: [],
        serviceAccountId: SERVICE_ACCOUNT_ID,
        actorServiceAccountId: SERVICE_ACCOUNT_ID,
        credential: {
          kind: "api_token",
          id: CREDENTIAL_ID,
          scopes: ["grids:write"],
          permissionCap: "write",
          expiresAt: "2026-07-16T00:00:00.000Z",
          resourceBinding: { appId: "grids", resourceType: "base", resourceId: BASE_ID },
        },
      },
      services: {
        ...commonServices(),
        audit,
        updateRecord: mock(async () => ({ ok: true as const, data: record })),
      },
      effectIntents: executingIntents(),
    });
    const step = actionStep("updateRecord", { record: "inputs.item", set: { Status: "Done" } });
    const ctx = context("execute", step, {
      plan: boundPlan({ "steps.0.updateRecord.set.Status": FIELD_ID }),
      references: { "inputs.item": { kind: "record", tableId: TABLE_ID, recordId: RECORD_ID } },
    }).value;

    await ports.execute.get("updateRecord")!.execute(ctx, step);

    expect(audit.mock.calls[0]![0]).toMatchObject({
      diff: {
        workflowRecordUpdate: {
          new: {
            actorServiceAccountId: SERVICE_ACCOUNT_ID,
            credentialId: CREDENTIAL_ID,
            credentialKind: "api_token",
            credentialScopes: ["grids:write"],
            credentialPermissionCap: "write",
            credentialResourceBinding: { appId: "grids", resourceType: "base", resourceId: BASE_ID },
          },
        },
      },
    });
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
    expect(authorizeExecution).toHaveBeenCalledTimes(2);
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

  test("blocks an effect when execution permission is revoked after action preparation", async () => {
    let checks = 0;
    const authorizeExecution = mock(async () => {
      checks += 1;
      return checks === 1;
    });
    const update = mock(async () => ({ ok: true as const, data: record }));
    const ports = createGridsWorkflowActionPorts({
      workflow,
      authorizeExecution,
      services: { ...commonServices(), updateRecord: update },
      effectIntents: executingIntents(),
    });
    const step = actionStep("updateRecord", { record: "inputs.item", set: { Status: "Done" } });
    const ctx = context("execute", step, {
      plan: boundPlan({ "steps.0.updateRecord.set.Status": FIELD_ID }),
      references: { "inputs.item": { kind: "record", tableId: TABLE_ID, recordId: RECORD_ID } },
    }).value;

    const outcome = await ports.execute.get("updateRecord")!.execute(ctx, step);

    expect(outcome).toMatchObject({ state: "failed", error: { code: "FORBIDDEN" } });
    expect(authorizeExecution).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
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

  test("dry-run composes generated documents, public links, and email data", async () => {
    const variables = new Variables();
    const services = {
      ...commonServices(),
      getDocumentTemplate: mock(
        async () =>
          ({
            id: TEMPLATE_ID,
            tableId: TABLE_ID,
            name: "Agreement",
            enabled: true,
          }) as DocumentTemplate,
      ),
      getDocumentRun: mock(async () => null),
      getEmailTemplate: mock(async () => emailTemplate),
    };
    const ports = createGridsWorkflowActionPorts({ workflow, services, effectIntents: executingIntents() });
    const documentStep = actionStep("generateDocument", { template: "Agreement", record: "inputs.item", saveAs: "agreement" }, [
      "steps",
      0,
    ]);
    const documentCtx = context("dryRun", documentStep, {
      variables,
      references: { "inputs.item": { kind: "record", tableId: TABLE_ID, recordId: RECORD_ID } },
      plan: boundPlan({ "steps.0.generateDocument.template": TEMPLATE_ID }),
    });
    const documentOutcome = await ports.dryRun.get("generateDocument")!.plan(documentCtx.value, documentStep);

    const linkStep = actionStep("createDocumentLink", { document: "agreement", expiresIn: "7d", saveAs: "agreementLink" }, ["steps", 1]);
    const linkCtx = context("dryRun", linkStep, {
      variables,
      resolveReference: async (reference) => variables.get(reference),
    });
    const linkOutcome = await ports.dryRun.get("createDocumentLink")!.plan(linkCtx.value, linkStep);

    const emailStep = actionStep(
      "sendEmail",
      {
        template: "Notice",
        to: [{ email: "ada@example.test" }],
        data: { downloadUrl: "agreementLink.url" },
      },
      ["steps", 2],
    );
    const emailCtx = context("dryRun", emailStep, {
      variables,
      plan: boundPlan({ "steps.2.sendEmail.template": TEMPLATE_ID }),
      evaluate: async (value) => {
        if (value !== "agreementLink.url") return value;
        const link = variables.get("agreementLink");
        return link && typeof link === "object" && !Array.isArray(link) ? (link.url ?? null) : null;
      },
    });
    const emailOutcome = await ports.dryRun.get("sendEmail")!.plan(emailCtx.value, emailStep);

    expect(documentOutcome).toMatchObject({ state: "planned", output: { kind: "documentRun", planned: true } });
    expect(linkOutcome).toMatchObject({ state: "planned", output: { kind: "documentLink", planned: true, expiresIn: "7d" } });
    expect(emailOutcome).toMatchObject({ state: "planned", effects: [{ action: "sendEmail", recipientCount: 1 }] });
    expect(services.getDocumentRun).not.toHaveBeenCalled();
    expect(variables.get("agreementLink")).toMatchObject({
      url: expect.stringContaining("https://example.invalid/grids-document-link/"),
    });
  });

  test("persists only the document summary as the step output", async () => {
    // Step outcomes are readable with workflow "read" alone, so the rendered
    // record content must never reach them.
    const generatedRun = {
      id: "00000000-0000-4000-8000-00000000000a",
      shortId: "docaa",
      templateId: TEMPLATE_ID,
      workflowRunId: "00000000-0000-4000-8000-00000000000b",
      snapshotId: "00000000-0000-4000-8000-00000000000c",
      baseId: BASE_ID,
      tableId: TABLE_ID,
      recordId: RECORD_ID,
      documentNumber: "AGR-20260725-1",
      filename: "agreement.pdf",
      tags: ["agreement"],
      templateSnapshot: { html: "<p>{{ record.data.iban }}</p>" },
      renderData: { record: { data: { iban: "DE00 1234 5678" } } },
      generatedBy: null,
      generatedAt: "2026-07-25T00:00:00.000Z",
    };
    const services = {
      ...commonServices(),
      getDocumentTemplate: mock(async () => ({ id: TEMPLATE_ID, tableId: TABLE_ID, name: "Agreement", enabled: true }) as DocumentTemplate),
      generateDocument: mock(async () => ({ ok: true as const, data: generatedRun })),
    };
    const ports = createGridsWorkflowActionPorts({ workflow, services, effectIntents: executingIntents() });
    const step = actionStep("generateDocument", { template: "Agreement", record: "inputs.item", saveAs: "agreement" }, ["steps", 0]);
    const ctx = context("execute", step, {
      references: { "inputs.item": { kind: "record", tableId: TABLE_ID, recordId: RECORD_ID } },
      plan: boundPlan({ "steps.0.generateDocument.template": TEMPLATE_ID }),
    });

    const outcome = await ports.execute.get("generateDocument")!.execute(ctx.value, step);

    const output = (outcome as { output?: Record<string, unknown> }).output ?? {};
    expect(output).toMatchObject({ id: generatedRun.id, filename: "agreement.pdf", documentNumber: "AGR-20260725-1" });
    expect(output).not.toHaveProperty("renderData");
    expect(output).not.toHaveProperty("templateSnapshot");
    expect(JSON.stringify(output)).not.toContain("DE00 1234 5678");
  });

  test("does not blindly retry an intent whose external outcome is unknown", async () => {
    const send = mock(async () => ({ ok: true as const, data: { recipients: [] } }));
    const prepare = mock(async () => ({
      state: "needs_attention" as const,
      error: { code: "WORKFLOW_EFFECT_OUTCOME_UNKNOWN", message: "unknown", retryable: false },
    }));
    const intents: GridsWorkflowEffectIntentPort = {
      prepare,
      begin: mock(async () => undefined),
      executeTransactional: mock(async () => ({
        state: "needs_attention" as const,
        error: { code: "WORKFLOW_EFFECT_OUTCOME_UNKNOWN", message: "unknown", retryable: false },
      })),
      succeed: mock(async () => undefined),
      retry: mock(async () => undefined),
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
    expect(intents.retry).not.toHaveBeenCalled();
  });

  test("releases the intent for retry when HTTP fails before dispatch", async () => {
    const intents = executingIntents();
    const ports = createGridsWorkflowActionPorts({
      workflow,
      services: {
        ...commonServices(),
        httpRequest: mock(async () => ({
          ok: false as const,
          error: {
            code: "WORKFLOW_HTTP_RETRYABLE",
            message: "The request was not sent.",
            status: 503,
            retryable: true,
          },
        })),
      },
      effectIntents: intents,
    });
    const step = actionStep("httpRequest", { url: "https://api.example.test/hook", method: "POST" });
    const ctx = context("execute", step);

    const outcome = await ports.execute.get("httpRequest")!.execute(ctx.value, step);

    expect(outcome).toMatchObject({ state: "failed", error: { code: "WORKFLOW_HTTP_RETRYABLE", retryable: true } });
    expect(intents.retry).toHaveBeenCalledTimes(1);
    expect(intents.needsAttention).not.toHaveBeenCalled();
    expect(intents.fail).not.toHaveBeenCalled();
  });

  test("preflights HTTP safety during dry runs without executing the request", async () => {
    const preflight = mock(async () => ({ ok: true as const, data: { host: "api.example.test" } }));
    const request = mock(async () => ({ ok: true as const, data: { status: 200, ok: true, body: "ok", host: "api.example.test" } }));
    const ports = createGridsWorkflowActionPorts({
      workflow,
      services: { ...commonServices(), httpRequest: request, httpRequestPreflight: preflight },
      effectIntents: executingIntents(),
    });
    const step = actionStep("httpRequest", { url: "https://api.example.test/hook", method: "POST" });
    const ctx = context("dryRun", step);

    const outcome = await ports.dryRun.get("httpRequest")!.plan(ctx.value, step);

    expect(outcome.state).toBe("planned");
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  test("marks unresolved HTTP dry-run targets as indeterminate", async () => {
    const ports = createGridsWorkflowActionPorts({
      workflow,
      services: {
        ...commonServices(),
        httpRequestPreflight: mock(async () => ({
          ok: false as const,
          error: { code: "BAD_INPUT", message: "HTTP request target could not be resolved", status: 400 },
        })),
      },
      effectIntents: executingIntents(),
    });
    const step = actionStep("httpRequest", { url: "https://missing.example.test/hook", method: "POST" });
    const ctx = context("dryRun", step);

    const outcome = await ports.dryRun.get("httpRequest")!.plan(ctx.value, step);

    expect(outcome).toEqual({ state: "indeterminate", reason: "HTTP request target could not be resolved" });
  });

  test("returns retryable durable-intent failures to the runtime retry path", async () => {
    const intents = executingIntents();
    const ports = createGridsWorkflowActionPorts({
      workflow,
      services: {
        ...commonServices(),
        getEmailTemplate: mock(async () => emailTemplate),
        getActiveStepRunId: mock(async () => "00000000-0000-4000-8000-000000000011"),
        sendEmail: mock(async () => ({
          ok: false as const,
          error: { code: "MAIL_UNAVAILABLE", message: "Mail is unavailable", status: 503 },
        })),
      },
      effectIntents: intents,
    });
    const step = actionStep("sendEmail", { template: "Notice", to: [{ email: "ada@example.test" }] });
    const ctx = context("execute", step, { plan: boundPlan({ "steps.0.sendEmail.template": TEMPLATE_ID }) });

    const outcome = await ports.execute.get("sendEmail")!.execute(ctx.value, step);

    expect(outcome).toMatchObject({ state: "failed", error: { code: "MAIL_UNAVAILABLE", retryable: true } });
    expect(intents.retry).toHaveBeenCalledTimes(1);
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

describe("declared action scope", () => {
  const invocation = {
    workflowId: "11111111-1111-4111-8111-111111111111",
    mode: "execute" as const,
    channel: "event",
    actor: { kind: "user" as const, userId: "u-1", groupIds: ["g-1"] },
    inputs: {},
    idempotencyKey: "k",
    occurredAt: "2026-01-01T00:00:00.000Z",
  };

  test("reads the base and the actor its app attached", () => {
    const scope = gridsWorkflowActionScope({
      ...invocation,
      context: { baseId: "b-1", workflowShortId: "AB123", workflowName: "Nightly" },
    } as never);

    expect(scope.workflow).toEqual({ id: invocation.workflowId, baseId: "b-1", shortId: "AB123", name: "Nightly" });
    expect(scope.principal?.userId).toBe("u-1");
    expect(scope.principal?.groupIds).toEqual(["g-1"]);
  });

  test("refuses a run with no base rather than guessing one", () => {
    // An action running against the wrong base — or none — would authorize
    // against the wrong world, so this is loud.
    expect(() => gridsWorkflowActionScope({ ...invocation, context: {} } as never)).toThrow(/base/i);
  });
});
