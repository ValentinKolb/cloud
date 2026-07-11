import type { WorkflowDefinition, WorkflowInput, WorkflowInputType, WorkflowTriggerKind } from "../contracts";
import type { WorkflowDiagnostic } from "./dsl";

type RefKind = WorkflowInputType | "record" | "document" | "documentLink" | "email";

const compactPath = (path: (string | number)[]): string => (path.length === 0 ? "workflow" : path.map(String).join("."));

const inputKind = (inputs: Record<string, WorkflowInput>, name: string): WorkflowInputType | null => inputs[name]?.type ?? null;

const activeTriggerKinds = (definition: WorkflowDefinition): WorkflowTriggerKind[] => {
  const triggers = definition.triggers;
  const entries: Array<[WorkflowTriggerKind, unknown]> = [
    ["form", triggers.form],
    ["api", triggers.api],
    ["scanner", triggers.scanner],
    ["bulkSelection", triggers.bulkSelection],
    ["dashboardButton", triggers.dashboardButton],
    ["schedule", triggers.schedule],
    ["recordEvent", triggers.recordEvent],
  ];
  return entries
    .filter(([, trigger]) => {
      if (!trigger) return false;
      return !(typeof trigger === "object" && trigger !== null && (trigger as { enabled?: unknown }).enabled === false);
    })
    .map(([kind]) => kind);
};

const providedInputsForTrigger = (definition: WorkflowDefinition, kind: WorkflowTriggerKind): Set<string> | "all" => {
  switch (kind) {
    case "form":
    case "api":
      return "all";
    case "scanner":
      return new Set([definition.triggers.scanner?.input].filter((input): input is string => Boolean(input)));
    case "bulkSelection":
      return new Set([definition.triggers.bulkSelection?.input].filter((input): input is string => Boolean(input)));
    case "recordEvent":
      return new Set([definition.triggers.recordEvent?.input].filter((input): input is string => Boolean(input)));
    case "dashboardButton":
    case "schedule":
      return new Set();
  }
};

const validateRequiredInputsForTriggers = (definition: WorkflowDefinition, diagnostics: WorkflowDiagnostic[]): void => {
  const requiredInputs = Object.entries(definition.inputs ?? {})
    .filter(([, input]) => input.required === true)
    .map(([name]) => name);
  if (requiredInputs.length === 0) return;

  for (const triggerKind of activeTriggerKinds(definition)) {
    const provided = providedInputsForTrigger(definition, triggerKind);
    if (provided === "all") continue;
    for (const inputName of requiredInputs) {
      if (provided.has(inputName)) continue;
      diagnostics.push({
        path: ["triggers", triggerKind],
        message: `triggers.${triggerKind}: required input "${inputName}" cannot be provided by this trigger`,
      });
    }
  }
};

const resolveRefKind = (ref: unknown, inputs: Record<string, WorkflowInput>, locals: Map<string, RefKind>): RefKind | null => {
  if (typeof ref !== "string") return null;
  const parts = ref.split(".");
  const first = parts[0];
  if (!first) return null;
  if (first === "inputs") {
    const inputName = parts[1];
    return inputName ? inputKind(inputs, inputName) : null;
  }
  return locals.get(first) ?? null;
};

const expectRefKind = (params: {
  ref: unknown;
  expected: RefKind;
  inputs: Record<string, WorkflowInput>;
  locals: Map<string, RefKind>;
  path: (string | number)[];
  diagnostics: WorkflowDiagnostic[];
  label: string;
}): void => {
  const actual = resolveRefKind(params.ref, params.inputs, params.locals);
  if (actual === params.expected) return;
  params.diagnostics.push({
    path: params.path,
    message:
      actual === null
        ? `${compactPath(params.path)}: ${params.label} must reference a known ${params.expected}`
        : `${compactPath(params.path)}: ${params.label} references ${actual}, expected ${params.expected}`,
  });
};

const inputValueRefName = (value: string): string | null => {
  if (value === "inputs") return "";
  if (!value.startsWith("inputs.")) return null;
  return value.split(".")[1] ?? "";
};

const validateInputValueRefs = (
  value: unknown,
  inputs: Record<string, WorkflowInput>,
  diagnostics: WorkflowDiagnostic[],
  path: (string | number)[],
): void => {
  if (typeof value === "string") {
    const inputName = inputValueRefName(value);
    if (inputName !== null && !inputs[inputName]) {
      diagnostics.push({
        path,
        message: `${compactPath(path)}: references unknown input "${inputName}"`,
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateInputValueRefs(item, inputs, diagnostics, [...path, index]));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      validateInputValueRefs(item, inputs, diagnostics, [...path, key]);
    }
  }
};

const validateTriggers = (definition: WorkflowDefinition, diagnostics: WorkflowDiagnostic[]): void => {
  const inputs = definition.inputs ?? {};
  const scannerInput = definition.triggers.scanner?.input;
  if (scannerInput) {
    const input = inputs[scannerInput];
    if (!input) {
      diagnostics.push({ path: ["triggers", "scanner", "input"], message: `triggers.scanner.input: unknown input "${scannerInput}"` });
    } else if (input.type !== "record") {
      diagnostics.push({ path: ["triggers", "scanner", "input"], message: "triggers.scanner.input must reference a record input" });
    }
    const resolve = definition.triggers.scanner?.resolve;
    if (resolve?.by === "field" && !resolve.field) {
      diagnostics.push({ path: ["triggers", "scanner", "resolve", "field"], message: "scanner resolve by field requires field" });
    }
  }

  const bulkInput = definition.triggers.bulkSelection?.input;
  if (bulkInput) {
    const input = inputs[bulkInput];
    if (!input) {
      diagnostics.push({
        path: ["triggers", "bulkSelection", "input"],
        message: `triggers.bulkSelection.input: unknown input "${bulkInput}"`,
      });
    } else if (input.type !== "recordList") {
      diagnostics.push({
        path: ["triggers", "bulkSelection", "input"],
        message: "triggers.bulkSelection.input must reference a recordList input",
      });
    }
  }

  const recordEventInput = definition.triggers.recordEvent?.input;
  if (recordEventInput) {
    const input = inputs[recordEventInput];
    if (!input) {
      diagnostics.push({
        path: ["triggers", "recordEvent", "input"],
        message: `triggers.recordEvent.input: unknown input "${recordEventInput}"`,
      });
    } else if (input.type !== "record") {
      diagnostics.push({ path: ["triggers", "recordEvent", "input"], message: "triggers.recordEvent.input must reference a record input" });
    }
  }

  validateRequiredInputsForTriggers(definition, diagnostics);
};

type StepValidationContext = {
  inputs: Record<string, WorkflowInput>;
  diagnostics: WorkflowDiagnostic[];
  path: (string | number)[];
  locals: Map<string, RefKind>;
};

const validateRecordAction = (ref: unknown, action: string, context: StepValidationContext): void =>
  expectRefKind({
    ref,
    expected: "record",
    inputs: context.inputs,
    locals: context.locals,
    diagnostics: context.diagnostics,
    path: [...context.path, action, "record"],
    label: "record",
  });

const validateSendEmailRecipients = (recipients: unknown, context: StepValidationContext): void => {
  if (!Array.isArray(recipients)) return;
  recipients.forEach((recipient, recipientIndex) => {
    if (!recipient || typeof recipient !== "object" || Array.isArray(recipient)) return;
    const keys = Object.keys(recipient);
    if (keys.length !== 1 || (keys[0] !== "email" && keys[0] !== "user")) {
      const recipientPath = [...context.path, "sendEmail", "to", recipientIndex];
      context.diagnostics.push({
        path: recipientPath,
        message: `${compactPath(recipientPath)}: recipient must use exactly one of email or user`,
      });
    }
    validateInputValueRefs(
      (recipient as { email?: unknown; user?: unknown }).email ?? (recipient as { email?: unknown; user?: unknown }).user,
      context.inputs,
      context.diagnostics,
      [...context.path, "sendEmail", "to", recipientIndex, keys[0] ?? "recipient"],
    );
  });
};

const validateCondition = (item: Record<string, unknown>, context: StepValidationContext): void => {
  const condition = item.if as { equals?: unknown[]; exists?: unknown; notEquals?: unknown[] };
  condition.equals?.forEach((value, valueIndex) =>
    validateInputValueRefs(value, context.inputs, context.diagnostics, [...context.path, "if", "equals", valueIndex]),
  );
  condition.notEquals?.forEach((value, valueIndex) =>
    validateInputValueRefs(value, context.inputs, context.diagnostics, [...context.path, "if", "notEquals", valueIndex]),
  );
  validateInputValueRefs(condition.exists, context.inputs, context.diagnostics, [...context.path, "if", "exists"]);
  if (Array.isArray(item.then)) validateSteps(item.then, context.inputs, context.diagnostics, [...context.path, "then"], context.locals);
  if (Array.isArray(item.else)) validateSteps(item.else, context.inputs, context.diagnostics, [...context.path, "else"], context.locals);
};

const validateSwitch = (item: Record<string, unknown>, context: StepValidationContext): void => {
  validateInputValueRefs(item.switch, context.inputs, context.diagnostics, [...context.path, "switch"]);
  if (Array.isArray(item.cases)) {
    item.cases.forEach((caseItem, caseIndex) => {
      if (!caseItem || typeof caseItem !== "object") return;
      validateInputValueRefs((caseItem as { when?: unknown }).when, context.inputs, context.diagnostics, [
        ...context.path,
        "cases",
        caseIndex,
        "when",
      ]);
      const steps = (caseItem as { do?: unknown }).do;
      if (Array.isArray(steps)) {
        validateSteps(steps, context.inputs, context.diagnostics, [...context.path, "cases", caseIndex, "do"], context.locals);
      }
    });
  }
  if (Array.isArray(item.default)) {
    validateSteps(item.default, context.inputs, context.diagnostics, [...context.path, "default"], context.locals);
  }
};

const validateStep = (item: Record<string, unknown>, context: StepValidationContext): void => {
  if ("updateRecord" in item) {
    const action = item.updateRecord as { record?: unknown; set?: unknown };
    validateRecordAction(action.record, "updateRecord", context);
    validateInputValueRefs(action.set, context.inputs, context.diagnostics, [...context.path, "updateRecord", "set"]);
    return;
  }
  if ("createRecord" in item) {
    const action = item.createRecord as { saveAs?: unknown; values?: unknown };
    validateInputValueRefs(action.values, context.inputs, context.diagnostics, [...context.path, "createRecord", "values"]);
    if (typeof action.saveAs === "string") context.locals.set(action.saveAs, "record");
    return;
  }
  if ("generateDocument" in item) {
    const action = item.generateDocument as { record?: unknown; filename?: unknown; saveAs?: unknown; tags?: unknown };
    validateRecordAction(action.record, "generateDocument", context);
    validateInputValueRefs(action.filename, context.inputs, context.diagnostics, [...context.path, "generateDocument", "filename"]);
    validateInputValueRefs(action.tags, context.inputs, context.diagnostics, [...context.path, "generateDocument", "tags"]);
    if (typeof action.saveAs === "string") context.locals.set(action.saveAs, "document");
    return;
  }
  if ("createDocumentLink" in item) {
    const action = item.createDocumentLink as { comment?: unknown; document?: unknown; saveAs?: unknown };
    expectRefKind({
      ref: action.document,
      expected: "document",
      inputs: context.inputs,
      locals: context.locals,
      diagnostics: context.diagnostics,
      path: [...context.path, "createDocumentLink", "document"],
      label: "document",
    });
    validateInputValueRefs(action.comment, context.inputs, context.diagnostics, [...context.path, "createDocumentLink", "comment"]);
    if (typeof action.saveAs === "string") context.locals.set(action.saveAs, "documentLink");
    return;
  }
  if ("sendEmail" in item) {
    const action = item.sendEmail as { data?: unknown; to?: unknown; saveAs?: unknown };
    validateSendEmailRecipients(action.to, context);
    validateInputValueRefs(action.data, context.inputs, context.diagnostics, [...context.path, "sendEmail", "data"]);
    if (typeof action.saveAs === "string") context.locals.set(action.saveAs, "email");
    return;
  }
  if ("httpRequest" in item) {
    validateInputValueRefs((item.httpRequest as { json?: unknown }).json, context.inputs, context.diagnostics, [
      ...context.path,
      "httpRequest",
      "json",
    ]);
    return;
  }
  if ("setVariable" in item) {
    validateInputValueRefs((item.setVariable as { value?: unknown }).value, context.inputs, context.diagnostics, [
      ...context.path,
      "setVariable",
      "value",
    ]);
    return;
  }
  if ("forEach" in item) {
    expectRefKind({
      ref: item.forEach,
      expected: "recordList",
      inputs: context.inputs,
      locals: context.locals,
      diagnostics: context.diagnostics,
      path: [...context.path, "forEach"],
      label: "forEach",
    });
    const nextLocals = new Map(context.locals);
    if (typeof item.as === "string") nextLocals.set(item.as, "record");
    if (Array.isArray(item.do)) validateSteps(item.do, context.inputs, context.diagnostics, [...context.path, "do"], nextLocals);
    return;
  }
  if ("if" in item) {
    validateCondition(item, context);
    return;
  }
  if ("switch" in item) validateSwitch(item, context);
};

const validateSteps = (
  steps: unknown[],
  inputs: Record<string, WorkflowInput>,
  diagnostics: WorkflowDiagnostic[],
  path: (string | number)[] = ["steps"],
  locals = new Map<string, RefKind>(),
): void => {
  steps.forEach((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return;
    validateStep(step as Record<string, unknown>, { inputs, diagnostics, path: [...path, index], locals });
  });
};

export const validateWorkflowDefinition = (definition: WorkflowDefinition): WorkflowDiagnostic[] => {
  const diagnostics: WorkflowDiagnostic[] = [];
  validateTriggers(definition, diagnostics);
  validateSteps(definition.steps, definition.inputs ?? {}, diagnostics);
  return diagnostics;
};
