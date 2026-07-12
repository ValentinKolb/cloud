import { arg, command, confirmFlag, flag } from "@valentinkolb/cloud/cli";
import type { DocumentRunSummaryList, EmailTemplate, Workflow, WorkflowAutocompleteResponse, WorkflowRun } from "../contracts";
import { documentRunRows } from "./documents-support";
import { baseArgs, baseFlag, resolveBaseFromCommand } from "./resources";
import {
  applyDefined,
  JSON_BODY_INPUT,
  jsonRequest,
  type MessageResponse,
  printAutocomplete,
  printDiagnostics,
  printJsonOrMessage,
  printJsonOrTable,
  printReference,
  queryString,
  readApi,
  readJsonInput,
  readTextInput,
  writeApiFile,
} from "./runtime";
import {
  EMAIL_TEMPLATE_REFERENCE,
  emailTemplateFlag,
  emailTemplateRows,
  JSON_BODY_NAMED_INPUT,
  listEmailTemplates,
  listWorkflows,
  resolveEmailTemplateFromCommand,
  resolveWorkflow,
  resolveWorkflowFromCommand,
  WORKFLOW_BULK_QUERY_INPUT,
  WORKFLOW_REFERENCE,
  WORKFLOW_SOURCE_INPUT,
  WORKFLOW_TRIGGER_INPUT,
  type WorkflowEmailDeliveryListResponse,
  type WorkflowRunListResponse,
  type WorkflowStepRunListResponse,
  type WorkflowValidateResponse,
  workflowEmailRows,
  workflowFlag,
  workflowRows,
  workflowRunRows,
  workflowStepRows,
} from "./workflows-support";

export const emailTemplateCommands = [
  command("email-templates reference", {
    summary: "Show workflow email template fields, Liquid data, and examples",
    description: "Use this before creating workflow email templates from an agent.",
    examples: ["cld grids email-templates reference", "cld grids email-templates reference --json"],
    async run({ ctx }) {
      printReference(
        ctx,
        EMAIL_TEMPLATE_REFERENCE,
        [
          "Workflow email templates",
          "",
          "Email templates have Liquid subject and HTML body fields. There is no plain-text fallback field.",
          "",
          "Fields:",
          ...Object.entries(EMAIL_TEMPLATE_REFERENCE.fields).map(([key, value]) => `  ${key}: ${value}`),
          "",
          "Liquid data:",
          ...EMAIL_TEMPLATE_REFERENCE.liquidData.map((item) => `  ${item}`),
          "",
          "Workflow step:",
          `  ${EMAIL_TEMPLATE_REFERENCE.example.step.replace(/\n/g, "\n  ")}`,
        ].join("\n"),
      );
    },
  }),
  command("email-templates list", {
    summary: "List workflow email templates for a base",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const templates = await listEmailTemplates(ctx, base.id);
      printJsonOrTable(ctx, templates, emailTemplateRows(templates), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "enabled", label: "ENABLED" },
        { key: "subject", label: "SUBJECT" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("email-templates get", {
    summary: "Show a workflow email template",
    args: baseArgs,
    flags: { ...baseFlag, ...emailTemplateFlag },
    async run({ ctx, args, flags }) {
      const { template } = await resolveEmailTemplateFromCommand(ctx, args.args, flags.template);
      if (ctx.options.output === "json") ctx.json(template);
      else {
        ctx.print(`${template.name} (${template.shortId})`);
        if (template.description) ctx.print(template.description);
        ctx.print(`subject: ${template.subject}`);
        ctx.print(`enabled: ${template.enabled ? "yes" : "no"}`);
        ctx.print(`id: ${template.id}`);
        ctx.print("");
        ctx.print(template.html);
      }
    },
  }),
  command("email-templates create", {
    summary: "Create a workflow email template",
    description: "Run `cld grids email-templates reference` for available fields, Liquid data, and a sendEmail workflow example.",
    args: baseArgs,
    flags: {
      ...baseFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Template name" }),
      description: flag.string({ description: "Template description" }),
      subject: flag.string({ description: "Email subject Liquid template" }),
      html: flag.string({ description: "Email HTML Liquid template" }),
      enabled: flag.boolean({ description: "Enable the template" }),
      disabled: flag.boolean({ description: "Create the template disabled" }),
      position: flag.int({ min: 0, description: "Template position" }),
    },
    examples: [
      "cld grids email-templates create Bookshop --name Reminder --subject 'Reminder: {{ data.itemName }}' --html '<p>{{ data.itemName }}</p>'",
      "cld grids email-templates create --base Bookshop --body-file email-template.json",
    ],
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "email template JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        subject: flags.subject,
        html: flags.html,
        enabled: flags.enabled ? true : flags.disabled ? false : undefined,
        position: flags.position,
      });
      if (!body.name) throw new Error("Missing email template name. Pass --name or --body JSON.");
      if (!body.subject) throw new Error("Missing email template subject. Pass --subject or --body JSON.");
      if (!body.html) throw new Error("Missing email template HTML. Pass --html or --body JSON.");
      const template = await readApi<EmailTemplate>(
        ctx,
        `/email-templates/by-base/${encodeURIComponent(base.id)}`,
        jsonRequest("POST", body),
      );
      printJsonOrMessage(ctx, template, `Created email template ${template.name} (${template.shortId}).`);
    },
  }),
  command("email-templates update", {
    summary: "Update a workflow email template",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...emailTemplateFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Template name" }),
      description: flag.string({ description: "Template description" }),
      subject: flag.string({ description: "Email subject Liquid template" }),
      html: flag.string({ description: "Email HTML Liquid template" }),
      enabled: flag.boolean({ description: "Enable the template" }),
      disabled: flag.boolean({ description: "Disable the template" }),
      position: flag.int({ min: 0, description: "Template position" }),
    },
    async run({ ctx, args, flags }) {
      const { template } = await resolveEmailTemplateFromCommand(ctx, args.args, flags.template);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "email template update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        subject: flags.subject,
        html: flags.html,
        enabled: flags.enabled ? true : flags.disabled ? false : undefined,
        position: flags.position,
      });
      const updated = await readApi<EmailTemplate>(ctx, `/email-templates/${encodeURIComponent(template.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated email template ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("email-templates delete", {
    summary: "Delete a workflow email template",
    args: baseArgs,
    flags: { ...baseFlag, ...emailTemplateFlag, yes: confirmFlag("Delete this email template") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { template } = await resolveEmailTemplateFromCommand(ctx, args.args, flags.template);
      await readApi<MessageResponse>(ctx, `/email-templates/${encodeURIComponent(template.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: template.id }, `Deleted email template ${template.name} (${template.shortId}).`);
    },
  }),
];

export const workflowCommands = [
  command("workflows reference", {
    summary: "Show workflow YAML structure, triggers, steps, and examples",
    description: "Use this before creating or updating workflows from an agent.",
    examples: ["cld grids workflows reference", "cld grids workflows reference --json"],
    async run({ ctx }) {
      printReference(
        ctx,
        WORKFLOW_REFERENCE,
        [
          "Workflows",
          "",
          "Workflow name and description are UI fields. YAML only defines inputs, triggers, and steps.",
          "",
          "Top-level keys:",
          ...WORKFLOW_REFERENCE.yaml.topLevel.map((item) => `  ${item}`),
          "",
          "Input types:",
          `  ${WORKFLOW_REFERENCE.yaml.inputTypes.join(", ")}`,
          "",
          "Triggers:",
          `  ${WORKFLOW_REFERENCE.yaml.triggers.join(", ")}`,
          "",
          "Steps:",
          ...WORKFLOW_REFERENCE.yaml.steps.map((item) => `  ${item}`),
          "",
          "Example:",
          `  ${WORKFLOW_REFERENCE.example.replace(/\n/g, "\n  ")}`,
        ].join("\n"),
      );
    },
  }),
  command("workflows list", {
    summary: "List workflows visible on a base",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const workflows = await listWorkflows(ctx, base.id);
      printJsonOrTable(ctx, workflows, workflowRows(workflows), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "enabled", label: "ENABLED" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("workflows get", {
    summary: "Show a workflow",
    args: baseArgs,
    flags: { ...baseFlag, ...workflowFlag },
    async run({ ctx, args, flags }) {
      const { workflow } = await resolveWorkflowFromCommand(ctx, args.args, flags.workflow);
      if (ctx.options.output === "json") ctx.json(workflow);
      else {
        ctx.print(`${workflow.name} (${workflow.shortId})`);
        if (workflow.description) ctx.print(workflow.description);
        ctx.print(`enabled: ${workflow.enabled ? "yes" : "no"}`);
        ctx.print(`id: ${workflow.id}`);
        ctx.print("");
        ctx.print(workflow.source);
      }
    },
  }),
  command("workflows create", {
    summary: "Create a workflow",
    description: "Run `cld grids workflows reference` for YAML structure, triggers, steps, and examples.",
    args: baseArgs,
    flags: {
      ...baseFlag,
      body: JSON_BODY_NAMED_INPUT,
      name: flag.string({ description: "Workflow name" }),
      description: flag.string({ description: "Workflow description" }),
      source: WORKFLOW_SOURCE_INPUT,
      enabled: flag.boolean({ description: "Enable the workflow" }),
      disabled: flag.boolean({ description: "Create the workflow disabled" }),
      position: flag.int({ min: 0, description: "Workflow position" }),
    },
    examples: [
      "cld grids workflows validate Bookshop --source-file workflow.yml",
      "cld grids workflows create Bookshop --name 'Send reminders' --source-file workflow.yml --enabled",
      "cld grids workflows create --base Bookshop --body-file workflow.json",
    ],
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "workflow JSON", false)) ?? {};
      const source = await readTextInput(flags.source, "workflow YAML", false);
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        source,
        enabled: flags.enabled ? true : flags.disabled ? false : undefined,
        position: flags.position,
      });
      if (!body.name) throw new Error("Missing workflow name. Pass --name or --body JSON.");
      if (!body.source) throw new Error("Missing workflow YAML. Pass --source, --source-file, -f, --stdin, or --body JSON.");
      const workflow = await readApi<Workflow>(ctx, `/workflows/by-base/${encodeURIComponent(base.id)}`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, workflow, `Created workflow ${workflow.name} (${workflow.shortId}).`);
    },
  }),
  command("workflows update", {
    summary: "Update a workflow",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...workflowFlag,
      body: JSON_BODY_NAMED_INPUT,
      name: flag.string({ description: "Workflow name" }),
      description: flag.string({ description: "Workflow description" }),
      source: WORKFLOW_SOURCE_INPUT,
      enabled: flag.boolean({ description: "Enable the workflow" }),
      disabled: flag.boolean({ description: "Disable the workflow" }),
      position: flag.int({ min: 0, description: "Workflow position" }),
    },
    async run({ ctx, args, flags }) {
      const { workflow } = await resolveWorkflowFromCommand(ctx, args.args, flags.workflow);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "workflow update JSON", false)) ?? {};
      const source = await readTextInput(flags.source, "workflow YAML", false);
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        source,
        enabled: flags.enabled ? true : flags.disabled ? false : undefined,
        position: flags.position,
      });
      const updated = await readApi<Workflow>(ctx, `/workflows/${encodeURIComponent(workflow.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated workflow ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("workflows delete", {
    summary: "Delete a workflow",
    args: baseArgs,
    flags: { ...baseFlag, ...workflowFlag, yes: confirmFlag("Delete this workflow") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { workflow } = await resolveWorkflowFromCommand(ctx, args.args, flags.workflow);
      await readApi<MessageResponse>(ctx, `/workflows/${encodeURIComponent(workflow.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: workflow.id }, `Deleted workflow ${workflow.name} (${workflow.shortId}).`);
    },
  }),
  command("workflows validate", {
    summary: "Validate workflow YAML",
    args: baseArgs,
    flags: { ...baseFlag, source: WORKFLOW_SOURCE_INPUT },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const source = await readTextInput(flags.source, "workflow YAML", true);
      const payload = await readApi<WorkflowValidateResponse>(
        ctx,
        `/workflows/by-base/${encodeURIComponent(base.id)}/validate`,
        jsonRequest("POST", { source }),
      );
      if (ctx.options.output === "json") {
        ctx.json(payload);
        return payload.ok ? 0 : 1;
      }
      if (!payload.ok) {
        printDiagnostics(ctx, payload.diagnostics);
        return 1;
      }
      ctx.print("Workflow YAML is valid.");
      return 0;
    },
  }),
  command("workflows autocomplete", {
    summary: "Return permission-safe workflow YAML autocomplete items",
    args: baseArgs,
    flags: {
      ...baseFlag,
      source: WORKFLOW_SOURCE_INPUT,
      caret: flag.int({ min: 0, max: 200_000, description: "UTF-16 caret offset" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const source = await readTextInput(flags.source, "workflow YAML", true);
      printAutocomplete(
        ctx,
        await readApi<WorkflowAutocompleteResponse>(
          ctx,
          `/workflows/by-base/${encodeURIComponent(base.id)}/autocomplete`,
          jsonRequest("POST", { source, ...(flags.caret !== undefined ? { caret: flags.caret } : {}) }),
        ),
      );
    },
  }),
  command("workflows trigger", {
    summary: "Trigger a workflow manually",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...workflowFlag,
      mode: flag.enum(["api", "form", "dashboard-button", "bulk-selection", "scanner", "schedule"] as const, {
        default: "api",
        description: "Trigger mode",
      }),
      input: WORKFLOW_TRIGGER_INPUT,
      code: flag.string({ description: "Scanner code for scanner mode" }),
      recordId: flag.stringList({ name: "record-id", description: "Record UUID for bulk-selection. Repeatable." }),
      bulkInput: flag.string({ name: "bulk-input", description: "Workflow input name for bulk-selection" }),
      query: WORKFLOW_BULK_QUERY_INPUT,
    },
    examples: [
      "cld grids workflows trigger Bookshop 'Send reminders' --input '{\"email\":\"ada@example.test\"}'",
      "cld grids workflows trigger Bookshop 'Scan item' --mode scanner --code '<scan-code>'",
      "cld grids workflows trigger Bookshop 'Print labels' --mode bulk-selection --bulk-input items --record-id <record-uuid>",
      "cld grids workflows trigger Bookshop 'Nightly sync' --mode schedule",
    ],
    async run({ ctx, args, flags }) {
      const { workflow } = await resolveWorkflowFromCommand(ctx, args.args, flags.workflow);
      if (flags.mode === "schedule") {
        const response = await readApi<MessageResponse>(
          ctx,
          `/workflows/${encodeURIComponent(workflow.id)}/run/schedule`,
          jsonRequest("POST", {}),
        );
        printJsonOrMessage(ctx, response, response.message ?? "Scheduled workflow run requested.");
        return;
      }
      if (flags.mode === "scanner") {
        if (!flags.code) throw new Error("Missing scanner code. Pass --code.");
        const run = await readApi<WorkflowRun>(
          ctx,
          `/workflows/${encodeURIComponent(workflow.id)}/run/scanner`,
          jsonRequest("POST", { code: flags.code }),
        );
        printJsonOrMessage(ctx, run, `Queued workflow run ${run.id} (${run.status}).`);
        return;
      }
      if (flags.mode === "bulk-selection") {
        const query = await readJsonInput<Record<string, unknown>>(flags.query, "bulk record query JSON", false);
        const recordIds = flags.recordId.length > 0 ? flags.recordId : undefined;
        if ((recordIds === undefined) === (query === undefined)) throw new Error("Pass either --record-id or --query/--query-file.");
        const run = await readApi<WorkflowRun>(
          ctx,
          `/workflows/${encodeURIComponent(workflow.id)}/run/bulk-selection`,
          jsonRequest("POST", { input: flags.bulkInput, recordIds, query }),
        );
        printJsonOrMessage(ctx, run, `Queued workflow run ${run.id} (${run.status}).`);
        return;
      }
      const input = (await readJsonInput<Record<string, unknown>>(flags.input, "workflow input JSON", false)) ?? {};
      const endpoint = flags.mode === "dashboard-button" ? "dashboard-button" : flags.mode;
      const run = await readApi<WorkflowRun>(
        ctx,
        `/workflows/${encodeURIComponent(workflow.id)}/run/${endpoint}`,
        jsonRequest("POST", { input }),
      );
      printJsonOrMessage(ctx, run, `Queued workflow run ${run.id} (${run.status}).`);
    },
  }),
];

export const workflowRunCommands = [
  command("workflow-runs list", {
    summary: "List workflow runs visible on a base",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...workflowFlag,
      status: flag.enum(["queued", "running", "succeeded", "failed", "canceled"] as const, { description: "Run status" }),
      cursor: flag.string({ description: "Pagination cursor" }),
      limit: flag.int({ min: 1, max: 200, description: "Maximum runs" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const workflow = flags.workflow ? await resolveWorkflow(ctx, base.id, flags.workflow) : null;
      const payload = await readApi<WorkflowRunListResponse>(
        ctx,
        `/workflows/by-base/${encodeURIComponent(base.id)}/runs${queryString({
          workflowId: workflow?.id,
          status: flags.status,
          cursor: flags.cursor,
          limit: flags.limit,
        })}`,
      );
      printJsonOrTable(ctx, payload, workflowRunRows(payload.items), [
        { key: "id", label: "SHORT" },
        { key: "workflowId", label: "WORKFLOW" },
        { key: "trigger", label: "TRIGGER" },
        { key: "status", label: "STATUS" },
        { key: "createdAt", label: "CREATED" },
        { key: "runId", label: "ID" },
      ]);
      if (ctx.options.output !== "json" && payload.nextCursor) ctx.print(`next cursor: ${payload.nextCursor}`);
    },
  }),
  command("workflow-runs get", {
    summary: "Show a workflow run",
    args: { run: arg.required({ description: "Workflow run UUID" }) },
    async run({ ctx, args }) {
      const run = await readApi<WorkflowRun>(ctx, `/workflows/runs/${encodeURIComponent(args.run)}`);
      if (ctx.options.output === "json") ctx.json(run);
      else {
        ctx.print(`${run.id} (${run.status})`);
        ctx.print(`workflow: ${run.workflowId ?? "-"}`);
        ctx.print(`trigger: ${run.triggerKind}`);
        if (run.error) ctx.print(`error: ${run.error}`);
      }
    },
  }),
  command("workflow-runs steps", {
    summary: "List workflow run steps",
    args: { run: arg.required({ description: "Workflow run UUID" }) },
    async run({ ctx, args }) {
      const payload = await readApi<WorkflowStepRunListResponse>(ctx, `/workflows/runs/${encodeURIComponent(args.run)}/steps`);
      printJsonOrTable(ctx, payload, workflowStepRows(payload.items), [
        { key: "index", label: "#" },
        { key: "path", label: "PATH" },
        { key: "kind", label: "KIND" },
        { key: "status", label: "STATUS" },
        { key: "durationMs", label: "MS" },
        { key: "error", label: "ERROR" },
      ]);
    },
  }),
  command("workflow-runs documents", {
    summary: "List documents generated by a workflow run",
    args: { run: arg.required({ description: "Workflow run UUID" }) },
    flags: {
      limit: flag.int({ min: 1, max: 500, description: "Maximum documents" }),
      offset: flag.int({ min: 0, description: "Document offset" }),
    },
    async run({ ctx, args, flags }) {
      const payload = await readApi<DocumentRunSummaryList>(
        ctx,
        `/workflows/runs/${encodeURIComponent(args.run)}/documents${queryString({ limit: flags.limit, offset: flags.offset })}`,
      );
      printJsonOrTable(ctx, payload, documentRunRows(payload.items), [
        { key: "shortId", label: "SHORT" },
        { key: "number", label: "NUMBER" },
        { key: "filename", label: "FILENAME" },
        { key: "tags", label: "TAGS" },
        { key: "generatedAt", label: "GENERATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("workflow-runs download-documents", {
    summary: "Download all documents generated by a workflow run as one PDF",
    args: { run: arg.required({ description: "Workflow run UUID" }) },
    flags: { out: flag.string({ description: "Output PDF path" }) },
    async run({ ctx, args, flags }) {
      await writeApiFile(ctx, `/workflows/runs/${encodeURIComponent(args.run)}/documents/download`, undefined, flags.out);
    },
  }),
];

export const workflowEmailCommands = [
  command("workflow-emails list", {
    summary: "List workflow email deliveries visible on a base",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...workflowFlag,
      cursor: flag.string({ description: "Pagination cursor" }),
      limit: flag.int({ min: 1, max: 200, description: "Maximum deliveries" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const workflow = flags.workflow ? await resolveWorkflow(ctx, base.id, flags.workflow) : null;
      const payload = await readApi<WorkflowEmailDeliveryListResponse>(
        ctx,
        `/workflows/by-base/${encodeURIComponent(base.id)}/email-deliveries${queryString({
          workflowId: workflow?.id,
          cursor: flags.cursor,
          limit: flags.limit,
        })}`,
      );
      printJsonOrTable(ctx, payload, workflowEmailRows(payload.items), [
        { key: "id", label: "SHORT" },
        { key: "workflowId", label: "WORKFLOW" },
        { key: "runId", label: "RUN" },
        { key: "status", label: "STATUS" },
        { key: "subject", label: "SUBJECT" },
        { key: "recipients", label: "RECIPIENTS" },
        { key: "createdAt", label: "CREATED" },
      ]);
      if (ctx.options.output !== "json" && payload.nextCursor) ctx.print(`next cursor: ${payload.nextCursor}`);
    },
  }),
];
