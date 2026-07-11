import type { WorkflowDefinition, WorkflowInput, WorkflowInputType, WorkflowTriggerKind } from "../contracts";
import type { WorkflowDiagnostic } from "./dsl";
import {
  hasInvalidWorkflowMessageExpression,
  parseWorkflowValueString,
  workflowMessageExpressions,
  workflowValueExpression,
} from "./value-expression";

type RefKind = WorkflowInputType | "record" | "document" | "documentLink" | "email" | "value";

const VALUE_PATHS: Partial<Record<RefKind, ReadonlySet<string>>> = {
  document: new Set([
    "id",
    "shortId",
    "templateId",
    "workflowRunId",
    "snapshotId",
    "baseId",
    "tableId",
    "recordId",
    "documentNumber",
    "filename",
    "tags",
    "generatedBy",
    "generatedAt",
  ]),
  documentLink: new Set(["kind", "id", "documentRunId", "url", "expiresAt"]),
  email: new Set(["templateId", "subject", "recipients"]),
};

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

const validateInputValueRefs = (
  value: unknown,
  inputs: Record<string, WorkflowInput>,
  diagnostics: WorkflowDiagnostic[],
  path: (string | number)[],
  locals = new Map<string, RefKind>(),
): void => {
  if (typeof value === "string") {
    const parsed = parseWorkflowValueString(value);
    if (parsed.kind === "invalid") {
      diagnostics.push({
        path,
        message: `${compactPath(path)}: invalid workflow value expression`,
      });
      return;
    }
    if (parsed.kind === "literal") return;
    if (parsed.expression.kind === "now") return;
    const reference = parsed.expression.reference;
    const [root, name, ...fieldPath] = reference.split(".");
    const kind = resolveRefKind(reference, inputs, locals);
    if (root === "inputs" && (!name || !inputs[name])) {
      diagnostics.push({ path, message: `${compactPath(path)}: references unknown input "${name ?? ""}"` });
    } else if (kind === null) {
      diagnostics.push({ path, message: `${compactPath(path)}: references unknown value "${root ?? ""}"` });
    } else {
      const valuePath = root === "inputs" ? fieldPath : reference.split(".").slice(1);
      if (valuePath.length > 0 && !["record", "document", "documentLink", "email", "value"].includes(kind)) {
        diagnostics.push({ path, message: `${compactPath(path)}: value paths require a record or structured value` });
      } else if (valuePath.length > 0) {
        const allowed = VALUE_PATHS[kind];
        if (allowed && !allowed.has(valuePath[0] ?? "")) {
          diagnostics.push({ path, message: `${compactPath(path)}: unknown ${kind} value path "${valuePath.join(".")}"` });
        }
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateInputValueRefs(item, inputs, diagnostics, [...path, index], locals));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      validateInputValueRefs(item, inputs, diagnostics, [...path, key], locals);
    }
  }
};

const inferredValueKind = (value: unknown, inputs: Record<string, WorkflowInput>, locals: Map<string, RefKind>): RefKind => {
  if (typeof value !== "string") return "value";
  const parsed = parseWorkflowValueString(value);
  if (parsed.kind !== "expression" || parsed.expression.kind !== "reference") return "value";
  const parts = parsed.expression.reference.split(".");
  const pathLength = parts[0] === "inputs" ? parts.length - 2 : parts.length - 1;
  if (pathLength > 0) return "value";
  return resolveRefKind(parsed.expression.reference, inputs, locals) ?? "value";
};

const saveLocal = (name: unknown, kind: RefKind, context: StepValidationContext, action: string): void => {
  if (typeof name !== "string") return;
  if (name === "inputs" || context.locals.has(name)) {
    const field = action === "setVariable" ? "name" : action === "forEach" ? "as" : "saveAs";
    context.diagnostics.push({
      path: [...context.path, action, field],
      message: `${compactPath(context.path)}: value name "${name}" is already defined`,
    });
    return;
  }
  context.locals.set(name, kind);
};

const validateMessage = (message: unknown, context: StepValidationContext, action: "fail" | "succeed"): void => {
  if (typeof message !== "string") return;
  const path = [...context.path, action, "message"];
  if (hasInvalidWorkflowMessageExpression(message)) {
    context.diagnostics.push({ path, message: `${compactPath(path)}: invalid workflow message expression` });
    return;
  }
  for (const item of workflowMessageExpressions(message)) {
    if (!item.expression) {
      context.diagnostics.push({ path, message: `${compactPath(path)}: invalid workflow message expression "${item.source}"` });
      continue;
    }
    validateInputValueRefs(workflowValueExpression(item.source), context.inputs, context.diagnostics, path, context.locals);
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
      context.locals,
    );
  });
};

const validateCondition = (item: Record<string, unknown>, context: StepValidationContext): void => {
  const condition = item.if as { equals?: unknown[]; exists?: unknown; notEquals?: unknown[] };
  condition.equals?.forEach((value, valueIndex) =>
    validateInputValueRefs(value, context.inputs, context.diagnostics, [...context.path, "if", "equals", valueIndex], context.locals),
  );
  condition.notEquals?.forEach((value, valueIndex) =>
    validateInputValueRefs(value, context.inputs, context.diagnostics, [...context.path, "if", "notEquals", valueIndex], context.locals),
  );
  if (condition.exists !== undefined) {
    validateInputValueRefs(
      workflowValueExpression(String(condition.exists)),
      context.inputs,
      context.diagnostics,
      [...context.path, "if", "exists"],
      context.locals,
    );
  }
  if (Array.isArray(item.then)) {
    validateSteps(item.then, context.inputs, context.diagnostics, [...context.path, "then"], new Map(context.locals));
  }
  if (Array.isArray(item.else)) {
    validateSteps(item.else, context.inputs, context.diagnostics, [...context.path, "else"], new Map(context.locals));
  }
};

const validateSwitch = (item: Record<string, unknown>, context: StepValidationContext): void => {
  validateInputValueRefs(item.switch, context.inputs, context.diagnostics, [...context.path, "switch"], context.locals);
  if (Array.isArray(item.cases)) {
    item.cases.forEach((caseItem, caseIndex) => {
      if (!caseItem || typeof caseItem !== "object") return;
      validateInputValueRefs(
        (caseItem as { when?: unknown }).when,
        context.inputs,
        context.diagnostics,
        [...context.path, "cases", caseIndex, "when"],
        context.locals,
      );
      const steps = (caseItem as { do?: unknown }).do;
      if (Array.isArray(steps)) {
        validateSteps(steps, context.inputs, context.diagnostics, [...context.path, "cases", caseIndex, "do"], new Map(context.locals));
      }
    });
  }
  if (Array.isArray(item.default)) {
    validateSteps(item.default, context.inputs, context.diagnostics, [...context.path, "default"], new Map(context.locals));
  }
};

const validateStep = (item: Record<string, unknown>, context: StepValidationContext): void => {
  if ("updateRecord" in item) {
    const action = item.updateRecord as { record?: unknown; set?: unknown };
    validateRecordAction(action.record, "updateRecord", context);
    validateInputValueRefs(action.set, context.inputs, context.diagnostics, [...context.path, "updateRecord", "set"], context.locals);
    return;
  }
  if ("createRecord" in item) {
    const action = item.createRecord as { saveAs?: unknown; values?: unknown };
    validateInputValueRefs(action.values, context.inputs, context.diagnostics, [...context.path, "createRecord", "values"], context.locals);
    saveLocal(action.saveAs, "record", context, "createRecord");
    return;
  }
  if ("generateDocument" in item) {
    const action = item.generateDocument as { record?: unknown; filename?: unknown; saveAs?: unknown; tags?: unknown };
    validateRecordAction(action.record, "generateDocument", context);
    validateInputValueRefs(
      action.filename,
      context.inputs,
      context.diagnostics,
      [...context.path, "generateDocument", "filename"],
      context.locals,
    );
    validateInputValueRefs(action.tags, context.inputs, context.diagnostics, [...context.path, "generateDocument", "tags"], context.locals);
    saveLocal(action.saveAs, "document", context, "generateDocument");
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
    validateInputValueRefs(
      action.comment,
      context.inputs,
      context.diagnostics,
      [...context.path, "createDocumentLink", "comment"],
      context.locals,
    );
    saveLocal(action.saveAs, "documentLink", context, "createDocumentLink");
    return;
  }
  if ("sendEmail" in item) {
    const action = item.sendEmail as { data?: unknown; to?: unknown; saveAs?: unknown };
    validateSendEmailRecipients(action.to, context);
    validateInputValueRefs(action.data, context.inputs, context.diagnostics, [...context.path, "sendEmail", "data"], context.locals);
    saveLocal(action.saveAs, "email", context, "sendEmail");
    return;
  }
  if ("httpRequest" in item) {
    const action = item.httpRequest as { json?: unknown; saveAs?: unknown };
    validateInputValueRefs(action.json, context.inputs, context.diagnostics, [...context.path, "httpRequest", "json"], context.locals);
    saveLocal(action.saveAs, "value", context, "httpRequest");
    return;
  }
  if ("setVariable" in item) {
    const action = item.setVariable as { name?: unknown; value?: unknown };
    validateInputValueRefs(action.value, context.inputs, context.diagnostics, [...context.path, "setVariable", "value"], context.locals);
    saveLocal(action.name, inferredValueKind(action.value, context.inputs, context.locals), context, "setVariable");
    return;
  }
  if ("fail" in item) {
    validateMessage((item.fail as { message?: unknown }).message, context, "fail");
    return;
  }
  if ("succeed" in item) {
    validateMessage((item.succeed as { message?: unknown }).message, context, "succeed");
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
    saveLocal(item.as, "record", { ...context, locals: nextLocals }, "forEach");
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
