import type { CloudCliContext } from "@valentinkolb/cloud/cli";
import { flag } from "@valentinkolb/cloud/cli";
import type { Base, EmailTemplate } from "../contracts";
import type {
  GridsWorkflowLauncher,
  GridsWorkflow as Workflow,
  GridsWorkflowEmailDelivery as WorkflowEmailDelivery,
  GridsWorkflowRun as WorkflowRun,
  GridsWorkflowStepRun as WorkflowStepRun,
} from "../workflows/contracts";
import { assertBaseScoped, resolveBaseFromCommand, UUID_RE } from "./resources";
import { compactId, exactMatch, readApi, requireRestArg } from "./runtime";

export type WorkflowRunListResponse = { items: WorkflowRun[]; nextCursor?: string | null };

export type WorkflowStepRunListResponse = { items: WorkflowStepRun[] };

export type WorkflowEmailDeliveryListResponse = { items: WorkflowEmailDelivery[]; nextCursor?: string | null };

export type WorkflowValidateResponse =
  | { ok: true; plan: unknown }
  | { ok: false; diagnostics: Array<{ message: string; path?: Array<string | number>; line?: number; column?: number }> };

export const JSON_BODY_NAMED_INPUT = flag.input({
  name: "body",
  fileName: "body-file",
  stdinName: false,
  valueLabel: "json",
});

export const WORKFLOW_SOURCE_INPUT = flag.input({
  name: "source",
  fileName: "source-file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "yaml",
});

export const WORKFLOW_INPUTS_INPUT = flag.input({
  name: "inputs",
  fileName: "inputs-file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "json",
});

export const WORKFLOW_LAUNCHER_BODY_INPUT = flag.input({
  name: "body",
  fileName: "body-file",
  fileAliases: ["f"],
  stdinName: "stdin",
  valueLabel: "json",
});

export const emailTemplateFlag = {
  template: flag.string({ description: "Email template id, short id, or exact name" }),
};

export const workflowFlag = {
  workflow: flag.string({ description: "Workflow id, short id, or exact name" }),
};

export const workflowLauncherFlag = {
  launcher: flag.string({ description: "Launcher id, short id, or exact name" }),
};

export const EMAIL_TEMPLATE_REFERENCE = {
  fields: {
    name: "Template label shown in workflow email actions.",
    subject: "Liquid subject template.",
    html: "Liquid HTML email body. There is no plain-text fallback field.",
    enabled: "Disabled templates cannot be selected in normal workflow flows.",
  },
  liquidData: ["workflow.name", "run.id", "data.<key>", "app.name", "business.legalName", "date.iso"],
  workflowUse: "Use sendEmail with template, to, optional data, and optional saveAs.",
  example: {
    subject: "Loan reminder for {{ data.itemName }}",
    html: "<p>Hello {{ data.customerName }},</p><p>Please return {{ data.itemName }}.</p>",
    step: "sendEmail:\n  template: Reminder\n  to:\n    - email: ${{ inputs.email }}\n  data:\n    itemName: ${{ inputs.item.Name }}",
  },
};

export const WORKFLOW_REFERENCE = {
  yaml: {
    topLevel: ["inputs", "triggers", "steps"],
    inputTypes: ["record", "recordList", "text", "number", "boolean", "date", "dateTime", "select"],
    triggers: ["schedule", "recordEvent"],
    steps: [
      "setVariable",
      "updateRecord",
      "createRecord",
      "generateDocument",
      "createDocumentLink",
      "sendEmail",
      "httpRequest",
      "if/then/else",
      "switch/cases/default",
      "forEach/as/do",
      "succeed",
      "fail",
    ],
  },
  invocation: {
    direct: {
      mode: "execute",
      inputs: { message: "hello" },
      idempotencyKey: "agent-job-42",
      expectedRevision: 3,
    },
    scanner: {
      operationId: "scan-42",
      mode: "execute",
      expectedRevision: 3,
      scannedText: "gsc_opaque",
      inputs: {},
    },
    bulkRecordIds: {
      operationId: "bulk-42",
      mode: "execute",
      expectedRevision: 3,
      recordIds: ["00000000-0000-4000-8000-000000000001"],
      inputs: {},
    },
    bulkQuery: {
      operationId: "bulk-query-42",
      mode: "dryRun",
      expectedRevision: 3,
      query: { limit: 100 },
      inputs: {},
    },
    dashboard: {
      operationId: "dashboard-42",
      mode: "execute",
      expectedRevision: 3,
      inputs: { range: "30d" },
    },
  },
  launchers: {
    scanner: {
      name: "Scan item",
      config: { kind: "scanner", input: "item", resolve: { by: "scanCode" } },
      enabled: true,
    },
    scannerByField: {
      name: "Scan asset tag",
      config: { kind: "scanner", input: "item", resolve: { by: "field", field: "Asset tag" } },
      enabled: true,
    },
    bulk: { name: "Process selection", config: { kind: "bulk", input: "items" }, enabled: true },
    dashboard: {
      name: "Run report",
      config: { kind: "dashboard", label: "Refresh", inputBindings: { range: "30d" } },
      enabled: true,
    },
  },
  values: {
    literals: "Plain strings are literal values, including strings containing dots.",
    dynamic: "Use an exact ${{ inputs.name }}, ${{ savedValue }}, or ${{ now() }} expression for dynamic WorkflowValue strings.",
    messages: "succeed/fail messages may embed ${{ ... }} expressions inside literal text.",
    dedicatedReferences: "record, forEach, document, and exists are reference slots and stay raw (for example, record: inputs.item).",
    scope: "Inputs exist for the whole run; saved values exist after their step; forEach aliases exist only inside do.",
  },
  example:
    "inputs:\n  item:\n    type: record\n    table: Items\nsteps:\n  - setVariable:\n      name: ranAt\n      value: ${{ now() }}\n  - updateRecord:\n      record: inputs.item\n      set:\n        Status: Checked",
};

export const listEmailTemplates = (ctx: CloudCliContext, baseId: string): Promise<EmailTemplate[]> =>
  readApi<EmailTemplate[]>(ctx, `/email-templates/by-base/${encodeURIComponent(baseId)}`);

const resolveEmailTemplate = async (ctx: CloudCliContext, baseId: string, ref: string): Promise<EmailTemplate> => {
  const template = UUID_RE.test(ref)
    ? await readApi<EmailTemplate>(ctx, `/email-templates/${encodeURIComponent(ref)}`)
    : exactMatch(
        await listEmailTemplates(ctx, baseId),
        ref,
        [(item) => item.id, (item) => item.shortId, (item) => item.name],
        "email template",
        (item) => `${item.name} (${item.shortId})`,
      );
  assertBaseScoped("Email template", baseId, template.baseId);
  return template;
};

export const listWorkflows = (ctx: CloudCliContext, baseId: string): Promise<Workflow[]> =>
  readApi<Workflow[]>(ctx, `/workflows/by-base/${encodeURIComponent(baseId)}`);

export const resolveWorkflow = async (ctx: CloudCliContext, baseId: string, ref: string): Promise<Workflow> => {
  const workflow = UUID_RE.test(ref)
    ? await readApi<Workflow>(ctx, `/workflows/${encodeURIComponent(ref)}`)
    : exactMatch(
        await listWorkflows(ctx, baseId),
        ref,
        [(item) => item.id, (item) => item.shortId, (item) => item.name],
        "workflow",
        (item) => `${item.name} (${item.shortId})`,
      );
  assertBaseScoped("Workflow", baseId, workflow.baseId);
  return workflow;
};

export const listWorkflowLaunchers = (ctx: CloudCliContext, workflowId: string): Promise<{ items: GridsWorkflowLauncher[] }> =>
  readApi<{ items: GridsWorkflowLauncher[] }>(ctx, `/workflows/${encodeURIComponent(workflowId)}/launchers`);

export const resolveWorkflowLauncher = async (ctx: CloudCliContext, workflow: Workflow, ref: string): Promise<GridsWorkflowLauncher> => {
  const launcher = UUID_RE.test(ref)
    ? await readApi<GridsWorkflowLauncher>(ctx, `/workflows/launchers/${encodeURIComponent(ref)}`)
    : exactMatch(
        (await listWorkflowLaunchers(ctx, workflow.id)).items,
        ref,
        [(item) => item.id, (item) => item.shortId, (item) => item.name],
        "workflow launcher",
        (item) => `${item.name} (${item.shortId})`,
      );
  if (launcher.workflowId !== workflow.id) throw new Error("Workflow launcher does not belong to the selected workflow.");
  return launcher;
};

export const emailTemplateRows = (items: EmailTemplate[]) =>
  items.map((template) => ({
    shortId: template.shortId,
    name: template.name,
    enabled: template.enabled ? "yes" : "no",
    subject: template.subject,
    updatedAt: template.updatedAt,
    id: template.id,
  }));

export const workflowRows = (items: Workflow[]) =>
  items.map((workflow) => ({
    shortId: workflow.shortId,
    name: workflow.name,
    enabled: workflow.enabled ? "yes" : "no",
    updatedAt: workflow.updatedAt,
    id: workflow.id,
  }));

export const workflowLauncherRows = (items: GridsWorkflowLauncher[]) =>
  items.map((launcher) => ({
    shortId: launcher.shortId,
    name: launcher.name,
    kind: launcher.config.kind,
    enabled: launcher.enabled ? "yes" : "no",
    revision: launcher.validatedRevision,
    diagnostics: launcher.diagnostics.length,
    id: launcher.id,
  }));

export const workflowRunRows = (items: WorkflowRun[]) =>
  items.map((run) => ({
    id: compactId(run.id),
    runId: run.id,
    workflowId: run.workflowId ?? "-",
    revision: run.workflowRevision,
    channel: run.channel,
    mode: run.mode,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt ?? "-",
  }));

export const workflowStepRows = (items: WorkflowStepRun[]) =>
  items.map((step) => ({
    key: step.key,
    path: step.sourcePath.join("."),
    iteration: step.iterationPath.join("."),
    kind: step.kind,
    action: step.action ?? "-",
    status: step.status,
    generation: step.executionGeneration,
    outcome: step.outcome === null ? "" : JSON.stringify(step.outcome),
  }));

export const workflowEmailRows = (items: WorkflowEmailDelivery[]) =>
  items.map((delivery) => ({
    id: compactId(delivery.id),
    workflowId: delivery.workflowId ?? "-",
    runId: delivery.workflowRunId ?? "-",
    status: delivery.status,
    subject: delivery.subject ?? "",
    recipients: delivery.recipients.map((recipient) => recipient.recipient).join(", "),
    createdAt: delivery.createdAt,
  }));

export const resolveEmailTemplateFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  templateRef: string | undefined,
): Promise<{ base: Base; template: EmailTemplate }> => {
  const { base, rest } = await resolveBaseFromCommand(ctx, args, templateRef ? 0 : 1);
  const ref = templateRef ?? requireRestArg(rest, 0, "email template");
  return { base, template: await resolveEmailTemplate(ctx, base.id, ref) };
};

export const resolveWorkflowFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  workflowRef: string | undefined,
): Promise<{ base: Base; workflow: Workflow }> => {
  const { base, rest } = await resolveBaseFromCommand(ctx, args, workflowRef ? 0 : 1);
  const ref = workflowRef ?? requireRestArg(rest, 0, "workflow");
  return { base, workflow: await resolveWorkflow(ctx, base.id, ref) };
};

export const resolveWorkflowLauncherFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  workflowRef: string | undefined,
  launcherRef: string | undefined,
): Promise<{ base: Base; workflow: Workflow; launcher: GridsWorkflowLauncher }> => {
  const trailingArgs = (workflowRef ? 0 : 1) + (launcherRef ? 0 : 1);
  const { base, rest } = await resolveBaseFromCommand(ctx, args, trailingArgs);
  const workflowReference = workflowRef ?? requireRestArg(rest, 0, "workflow");
  const launcherReference = launcherRef ?? requireRestArg(rest, workflowRef ? 0 : 1, "workflow launcher");
  const workflow = await resolveWorkflow(ctx, base.id, workflowReference);
  return { base, workflow, launcher: await resolveWorkflowLauncher(ctx, workflow, launcherReference) };
};
