import type { WorkflowFieldSchema, WorkflowLanguageManifest } from "@valentinkolb/cloud/workflows";

const identifier = (description: string, optional = false): WorkflowFieldSchema => ({
  kind: "string",
  format: "identifier",
  maxLength: 120,
  optional,
  description,
});

const text = (description: string, optional = false, maxLength = 1_000): WorkflowFieldSchema => ({
  kind: "string",
  minLength: 1,
  maxLength,
  optional,
  description,
});

const value = (description: string, optional = false): WorkflowFieldSchema => ({ kind: "value", optional, description });

const object = (properties: Record<string, WorkflowFieldSchema>): WorkflowFieldSchema & { kind: "object" } => ({
  kind: "object",
  properties,
});

const commonInputProperties = {
  label: text("Label shown when collecting this input.", true, 120),
  description: text("Additional guidance shown to the operator.", true),
  required: { kind: "boolean", optional: true, description: "Whether callers must provide this input." },
} satisfies Record<string, WorkflowFieldSchema>;

const recordValues = (description: string): WorkflowFieldSchema => ({
  kind: "record",
  minProperties: 1,
  values: value(description),
  description,
});

const saveAs = identifier("Name used to reference this action output in later steps.", true);

export const gridsWorkflowManifest: WorkflowLanguageManifest = {
  id: "grids",
  version: 1,
  limits: {
    maxInputs: 100,
    maxSteps: 1_000,
    maxDepth: 20,
    maxLoopItems: 10_000,
  },
  inputs: [
    {
      kind: "record",
      label: "Record",
      description: "One record from a configured table.",
      valueType: "grids.record",
      config: object({ table: text("Table name or ID."), ...commonInputProperties }),
    },
    {
      kind: "recordList",
      label: "Record list",
      description: "An ordered list of records from one configured table.",
      valueType: "grids.recordList",
      config: object({ table: text("Table name or ID."), ...commonInputProperties }),
    },
    ...(["text", "number", "boolean", "date", "dateTime"] as const).map((kind) => ({
      kind,
      label: kind === "dateTime" ? "Date and time" : `${kind[0]!.toUpperCase()}${kind.slice(1)}`,
      description: `A ${kind} value supplied when the workflow starts.`,
      valueType: `core.${kind}`,
      config: object(commonInputProperties),
    })),
    {
      kind: "select",
      label: "Select",
      description: "One value from a fixed set of options.",
      valueType: "core.text",
      config: object({
        ...commonInputProperties,
        options: {
          kind: "array",
          items: text("Option value.", false, 200),
          minItems: 1,
          maxItems: 200,
          description: "Allowed values.",
        },
      }),
    },
  ],
  triggers: [
    {
      kind: "schedule",
      label: "Schedule",
      description: "Starts the workflow for future cron slots in an IANA timezone.",
      snippet: 'schedule:\n  cron: "0 8 * * *"\n  timezone: Europe/Berlin\n  with: {}',
      eventValues: { occurredAt: "core.dateTime", slot: "core.dateTime" },
      config: object({
        cron: text("Five-field cron expression.", false, 120),
        timezone: text("IANA timezone. Defaults to UTC.", true, 80),
      }),
    },
    {
      kind: "recordEvent",
      label: "Record event",
      description: "Starts when a record is created, updated, or deleted.",
      snippet: "recordEvent:\n  event: updated\n  table: Items\n  with:\n    item: ${{ trigger.record }}",
      eventValues: {
        record: "grids.record",
        event: "core.text",
        occurredAt: "core.dateTime",
      },
      config: object({
        event: { kind: "string", enum: ["created", "updated", "deleted"], description: "Record event to observe." },
        table: text("Optional table restriction.", true, 200),
        filter: value("Optional server-side Grids filter tree.", true),
      }),
    },
  ],
  actions: [
    {
      kind: "updateRecord",
      label: "Update record",
      description: "Updates fields on one record after a current permission check.",
      effect: "transactional",
      dryRun: "full",
      outputType: "grids.record",
      config: object({
        record: text("Record input or output reference.", false, 500),
        set: recordValues("Fields and values to update."),
      }),
    },
    {
      kind: "createRecord",
      label: "Create record",
      description: "Creates one record in a table after a current permission check.",
      effect: "transactional",
      dryRun: "full",
      outputType: "grids.record",
      config: object({
        table: text("Target table name or ID.", false, 200),
        values: recordValues("Initial field values."),
        saveAs,
      }),
    },
    {
      kind: "generateDocument",
      label: "Generate document",
      description: "Creates a frozen document snapshot from a configured template.",
      effect: "durable-intent",
      dryRun: "validate",
      outputType: "grids.document",
      config: object({
        template: text("Document template name or ID.", false, 200),
        record: text("Record input or output reference.", false, 500),
        batch: { kind: "boolean", optional: true, description: "Render a multi-record document." },
        filename: value("Optional filename override.", true),
        tags: { kind: "array", items: value("Tag value."), maxItems: 20, optional: true },
        saveAs,
      }),
    },
    {
      kind: "createDocumentLink",
      label: "Create document link",
      description: "Creates a revocable public download link for a generated document.",
      effect: "transactional",
      dryRun: "validate",
      outputType: "grids.documentLink",
      config: object({
        document: text("Document output reference.", false, 500),
        expiresIn: { kind: "string", enum: ["1d", "7d", "30d", "90d"], optional: true },
        comment: value("Optional link comment.", true),
        saveAs,
      }),
    },
    {
      kind: "sendEmail",
      label: "Send email",
      description: "Renders a Grids email template and creates a durable delivery intent.",
      effect: "durable-intent",
      dryRun: "validate",
      outputType: "grids.emailDelivery",
      config: object({
        template: text("Email template name or ID.", false, 200),
        to: {
          kind: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            kind: "union",
            variants: [object({ email: value("Email address.") }), object({ user: value("User ID.") })],
          },
        },
        data: { kind: "record", values: value("Template value."), optional: true, maxProperties: 200 },
        saveAs,
      }),
    },
    {
      kind: "httpRequest",
      label: "HTTP request",
      description: "Sends an explicit JSON HTTP request. Ambiguous remote outcomes are never retried blindly.",
      effect: "ambiguous-external",
      dryRun: "validate",
      outputType: "core.value",
      config: object({
        method: { kind: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], optional: true },
        url: { kind: "string", format: "uri", maxLength: 4_000, description: "HTTP or HTTPS URL." },
        headers: { kind: "record", values: text("Header value.", false, 1_000), optional: true, maxProperties: 100 },
        json: value("JSON request payload.", true),
        timeoutMs: { kind: "number", integer: true, minimum: 1_000, maximum: 60_000, optional: true },
        saveAs,
      }),
    },
    {
      kind: "setVariable",
      label: "Set variable",
      description: "Stores a value for later steps in the current scope.",
      effect: "pure",
      dryRun: "full",
      outputType: "core.value",
      config: object({ name: identifier("Variable name."), value: value("Value to store.") }),
    },
    {
      kind: "fail",
      label: "Fail workflow",
      description: "Stops the workflow with a domain-specific error message.",
      effect: "pure",
      dryRun: "full",
      config: object({ message: text("Failure message.") }),
    },
    {
      kind: "succeed",
      label: "Succeed workflow",
      description: "Stops the workflow successfully with an operator-facing message.",
      effect: "pure",
      dryRun: "full",
      config: object({ message: text("Success message.") }),
    },
  ],
};
