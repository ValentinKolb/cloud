import type {
  WorkflowBoundPlan,
  WorkflowCondition,
  WorkflowDiagnostic,
  WorkflowIr,
  WorkflowIrStep,
  WorkflowJsonValue,
  WorkflowSourceLocation,
} from "@valentinkolb/cloud/workflows";
import { workflowPathKey } from "@valentinkolb/cloud/workflows";
import { bindWorkflow, parseWorkflowValueString, workflowMessageExpressions } from "@valentinkolb/cloud/workflows/language";
import {
  getMailWorkflowCatalogRef,
  type MailWorkflowCatalog,
  type MailWorkflowCatalogEntry,
  type MailWorkflowCatalogIndex,
  snapshotMailWorkflowCatalog,
} from "./catalog";
import { mailWorkflowManifest } from "./manifest";

export type BindMailWorkflowResult = { ok: true; plan: WorkflowBoundPlan } | { ok: false; diagnostics: WorkflowDiagnostic[] };

type ValueInfo = { type: string };

type BindingContext = {
  ir: WorkflowIr;
  catalog: MailWorkflowCatalog;
  inputs: Map<string, ValueInfo>;
  bindings: Record<string, WorkflowJsonValue>;
  diagnostics: WorkflowDiagnostic[];
};

const inputTypes = new Map(mailWorkflowManifest.inputs.map((input) => [input.kind, input.valueType]));

const valueFields: Record<string, ReadonlyMap<string, string>> = {
  "mail.message": new Map([
    ["id", "core.text"],
    ["conversationId", "core.text"],
    ["subject", "core.text"],
    ["sender", "core.value"],
    ["recipients", "core.value"],
    ["body", "core.text"],
    ["bodyText", "core.text"],
    ["bodyHtml", "core.text"],
    ["attachments", "core.value"],
    ["hasAttachments", "core.boolean"],
    ["folderId", "core.text"],
    ["flags", "core.value"],
    ["keywords", "core.value"],
    ["direction", "core.text"],
    ["internalDate", "core.dateTime"],
    ["receivedAt", "core.dateTime"],
  ]),
  "mail.conversation": new Map([
    ["id", "core.text"],
    ["subject", "core.text"],
    ["assigneeUserId", "core.text"],
    ["status", "core.text"],
    ["workStatus", "core.text"],
    ["responseNeeded", "core.boolean"],
    ["latestMessageAt", "core.dateTime"],
  ]),
  "mail.context": new Map([
    ["mailboxId", "core.text"],
    ["actor", "core.value"],
    ["occurredAt", "core.dateTime"],
  ]),
};

const locationForPath = (
  path: Array<string | number>,
  locations: Record<string, WorkflowSourceLocation>,
): WorkflowSourceLocation | undefined => {
  for (let length = path.length; length >= 0; length -= 1) {
    const location = locations[workflowPathKey(path.slice(0, length))];
    if (location) return location;
  }
  return undefined;
};

const addDiagnostic = (context: BindingContext, code: string, message: string, path: Array<string | number>): void => {
  const location = locationForPath(path, context.ir.sourceLocations);
  context.diagnostics.push({ code, message, severity: "error", path, ...(location ? { location } : {}) });
};

const bindId = (context: BindingContext, path: Array<string | number>, id: string): void => {
  context.bindings[workflowPathKey(path)] = id;
};

const resolveCatalogRef = <T extends MailWorkflowCatalogEntry>(
  context: BindingContext,
  index: MailWorkflowCatalogIndex<T>,
  reference: string,
  label: string,
  path: Array<string | number>,
): T | null => {
  if (index.ambiguous.has(reference)) {
    addDiagnostic(context, "binding.ambiguous", `Ambiguous ${label} reference "${reference}"`, path);
    return null;
  }
  const entry = getMailWorkflowCatalogRef(index, reference);
  if (!entry) {
    addDiagnostic(context, "binding.unknown", `Unknown or inaccessible ${label} "${reference}"`, path);
    return null;
  }
  bindId(context, path, entry.id);
  return entry;
};

const resolveTypedPath = (
  value: ValueInfo,
  parts: string[],
  reference: string,
  path: Array<string | number>,
  context: BindingContext,
): ValueInfo | null => {
  let current = value.type;
  for (const part of parts) {
    if (current === "core.value") return { type: current };
    const next = valueFields[current]?.get(part);
    if (!next) {
      addDiagnostic(context, "reference.path", `Reference "${reference}" does not expose "${part}"`, path);
      return null;
    }
    current = next;
  }
  return { type: current };
};

const resolveReference = (
  reference: string,
  path: Array<string | number>,
  scope: ReadonlyMap<string, ValueInfo>,
  context: BindingContext,
  triggerValues?: ReadonlyMap<string, ValueInfo>,
): ValueInfo | null => {
  const parts = reference.split(".");
  const root = parts.shift();
  let value: ValueInfo | undefined;

  if (triggerValues && root !== "trigger") {
    addDiagnostic(context, "reference.scope", `Reference "${reference}" is not available while binding a trigger`, path);
    return null;
  }

  if (root === "inputs") {
    const inputName = parts.shift();
    value = inputName ? context.inputs.get(inputName) : undefined;
    if (!value) {
      addDiagnostic(context, "reference.unknown", `Unknown input reference "${reference}"`, path);
      return null;
    }
  } else if (root === "trigger") {
    const eventName = parts.shift();
    value = triggerValues && eventName ? triggerValues.get(eventName) : undefined;
    if (!value) {
      addDiagnostic(context, "reference.unknown", `Unknown trigger value reference "${reference}"`, path);
      return null;
    }
  } else if (root === "context") {
    value = { type: "mail.context" };
  } else {
    value = root ? scope.get(root) : undefined;
    if (!value) {
      addDiagnostic(context, "reference.unknown", `Unknown value reference "${reference}"`, path);
      return null;
    }
  }

  return resolveTypedPath(value, parts, reference, path, context);
};

const expressionReference = (value: string): { kind: "literal"; value: string } | { kind: "expression"; value: string } | null => {
  const parsed = parseWorkflowValueString(value);
  if (parsed.kind === "literal") return { kind: "literal", value };
  if (parsed.kind === "expression" && parsed.expression.kind === "reference") {
    return { kind: "expression", value: parsed.expression.reference };
  }
  return null;
};

const bindValue = (
  value: WorkflowJsonValue,
  path: Array<string | number>,
  scope: ReadonlyMap<string, ValueInfo>,
  context: BindingContext,
): ValueInfo => {
  if (typeof value === "string") {
    const parsed = parseWorkflowValueString(value);
    if (parsed.kind === "invalid") addDiagnostic(context, "reference.invalid", "Invalid workflow value expression", path);
    else if (parsed.kind === "expression" && parsed.expression.kind === "reference") {
      return resolveReference(parsed.expression.reference, path, scope, context) ?? { type: "core.value" };
    } else if (parsed.kind === "expression") return { type: "core.dateTime" };
    return { type: "core.text" };
  }
  if (typeof value === "number") return { type: "core.number" };
  if (typeof value === "boolean") return { type: "core.boolean" };
  if (value === null) return { type: "core.null" };
  if (Array.isArray(value)) {
    value.forEach((item, index) => bindValue(item, [...path, index], scope, context));
    return { type: "core.array" };
  }
  for (const [key, item] of Object.entries(value)) bindValue(item, [...path, key], scope, context);
  return { type: "core.object" };
};

const expectReference = (
  value: WorkflowJsonValue | undefined,
  expectedType: string,
  label: string,
  path: Array<string | number>,
  scope: ReadonlyMap<string, ValueInfo>,
  context: BindingContext,
): void => {
  if (typeof value !== "string") return;
  const source = expressionReference(value);
  if (!source) {
    addDiagnostic(context, "reference.invalid", `${label} must be a value reference`, path);
    return;
  }
  const actual = resolveReference(source.value, path, scope, context);
  if (actual && actual.type !== expectedType) {
    addDiagnostic(context, "reference.type", `${label} references ${actual.type}, expected ${expectedType}`, path);
  }
};

const bindCatalogValue = <T extends MailWorkflowCatalogEntry>(
  value: WorkflowJsonValue | undefined,
  index: MailWorkflowCatalogIndex<T>,
  label: string,
  path: Array<string | number>,
  scope: ReadonlyMap<string, ValueInfo>,
  context: BindingContext,
  nullable = false,
): void => {
  if (value === null && nullable) return;
  if (typeof value !== "string") {
    addDiagnostic(context, "binding.type", `${label} must be a name, ID, or expression${nullable ? ", or null" : ""}`, path);
    return;
  }
  const source = expressionReference(value);
  if (!source) {
    addDiagnostic(context, "reference.invalid", `Invalid ${label} expression`, path);
  } else if (source.kind === "literal") {
    resolveCatalogRef(context, index, source.value, label, path);
  } else {
    const resolved = resolveReference(source.value, path, scope, context);
    if (resolved && resolved.type !== "core.text") {
      addDiagnostic(context, "reference.type", `${label} expression resolves to ${resolved.type}, expected core.text`, path);
    }
  }
};

const bindMessage = (
  value: WorkflowJsonValue | undefined,
  path: Array<string | number>,
  scope: ReadonlyMap<string, ValueInfo>,
  context: BindingContext,
): void => {
  if (typeof value !== "string") return;
  if (value.replace(/\$\{\{\s*[^{}]+?\s*\}\}/g, "").includes("${{")) {
    addDiagnostic(context, "reference.invalid", "Invalid workflow message expression", path);
    return;
  }
  workflowMessageExpressions(value).forEach((expression, index) => {
    if (!expression.expression)
      addDiagnostic(context, "reference.invalid", `Invalid workflow message expression "${expression.source}"`, path);
    else if (expression.expression.kind === "reference") {
      resolveReference(expression.expression.reference, [...path, "expression", index], scope, context);
    }
  });
};

const defineValue = (
  name: WorkflowJsonValue | undefined,
  value: ValueInfo,
  path: Array<string | number>,
  scope: Map<string, ValueInfo>,
  context: BindingContext,
): void => {
  if (typeof name !== "string") return;
  if (name === "inputs" || name === "trigger" || scope.has(name)) {
    addDiagnostic(context, "scope.duplicate", `Value name "${name}" is already defined in this scope`, path);
    return;
  }
  scope.set(name, value);
};

const bindCondition = (
  condition: WorkflowCondition,
  path: Array<string | number>,
  scope: ReadonlyMap<string, ValueInfo>,
  context: BindingContext,
): void => {
  if (condition.operator === "all" || condition.operator === "any") {
    condition.conditions.forEach((child, index) => bindCondition(child, [...path, condition.operator, index], scope, context));
  } else if (condition.operator === "not") {
    bindCondition(condition.condition, [...path, "not"], scope, context);
  } else if (condition.operator === "exists") {
    resolveReference(condition.reference, [...path, "exists"], scope, context);
  } else {
    condition.operands.forEach((operand, index) => {
      const operandPath = [...path, condition.operator, index];
      const value = bindValue(operand, operandPath, scope, context);
      if (
        (condition.operator === "contains" || condition.operator === "startsWith" || condition.operator === "endsWith") &&
        value.type !== "core.text" &&
        value.type !== "core.value"
      ) {
        addDiagnostic(
          context,
          "condition.type",
          `${condition.operator} operand ${index + 1} resolves to ${value.type}, expected core.text`,
          operandPath,
        );
      }
    });
  }
};

const bindAction = (step: Extract<WorkflowIrStep, { kind: "action" }>, scope: Map<string, ValueInfo>, context: BindingContext): void => {
  const path = [...step.sourcePath, step.action];
  const config = step.config;
  if (step.action === "addKeyword" || step.action === "removeKeyword") {
    expectReference(config.message, "mail.message", "message", [...path, "message"], scope, context);
    if (config.keyword !== undefined) bindValue(config.keyword, [...path, "keyword"], scope, context);
  } else if (step.action === "moveMessage") {
    expectReference(config.message, "mail.message", "message", [...path, "message"], scope, context);
    bindCatalogValue(config.folder, context.catalog.folders, "folder", [...path, "folder"], scope, context);
  } else if (step.action === "assignConversation") {
    expectReference(config.conversation, "mail.conversation", "conversation", [...path, "conversation"], scope, context);
    bindCatalogValue(config.user, context.catalog.assignableUsers, "assignable user", [...path, "user"], scope, context, true);
  } else if (step.action === "setConversationStatus") {
    expectReference(config.conversation, "mail.conversation", "conversation", [...path, "conversation"], scope, context);
  } else if (step.action === "setVariable") {
    const value = bindValue(config.value!, [...path, "value"], scope, context);
    defineValue(config.name, value, [...path, "name"], scope, context);
  } else if (step.action === "succeed" || step.action === "fail") {
    bindMessage(config.message, [...path, "message"], scope, context);
  }
};

const bindSteps = (steps: WorkflowIrStep[], scope: Map<string, ValueInfo>, context: BindingContext): void => {
  for (const step of steps) {
    if (step.kind === "action") bindAction(step, scope, context);
    else if (step.kind === "if") {
      bindCondition(step.condition, [...step.sourcePath, "if"], scope, context);
      bindSteps(step.then, new Map(scope), context);
      bindSteps(step.else, new Map(scope), context);
    } else if (step.kind === "switch") {
      bindValue(step.value, [...step.sourcePath, "switch"], scope, context);
      step.cases.forEach((item, index) => {
        bindValue(item.when, [...step.sourcePath, "cases", index, "when"], scope, context);
        bindSteps(item.steps, new Map(scope), context);
      });
      bindSteps(step.default, new Map(scope), context);
    } else {
      addDiagnostic(context, "step.unsupported", "forEach is not supported by the Mail workflow vocabulary", [
        ...step.sourcePath,
        "forEach",
      ]);
    }
  }
};

const bindInputs = (context: BindingContext): void => {
  for (const input of context.ir.inputs) context.inputs.set(input.name, { type: inputTypes.get(input.type) ?? "core.value" });
};

const typesCompatible = (expected: string, actual: string): boolean =>
  expected === actual || expected === "core.value" || (expected === "core.dateTime" && actual === "core.text");

const resolveTriggerBindingType = (
  value: WorkflowJsonValue,
  bindingPath: Array<string | number>,
  eventValues: ReadonlyMap<string, ValueInfo>,
  context: BindingContext,
): ValueInfo | null => {
  if (typeof value !== "string") return { type: "core.value" };
  const parsed = parseWorkflowValueString(value);
  if (parsed.kind === "invalid") {
    addDiagnostic(context, "reference.invalid", "Invalid trigger binding expression", bindingPath);
    return null;
  }
  if (parsed.kind !== "expression") return { type: "core.text" };
  if (parsed.expression.kind !== "reference") return { type: "core.dateTime" };
  return resolveReference(parsed.expression.reference, bindingPath, new Map(), context, eventValues);
};

const bindTrigger = (
  trigger: WorkflowIr["triggers"][number],
  descriptor: (typeof mailWorkflowManifest.triggers)[number],
  context: BindingContext,
): void => {
  const path = ["triggers", trigger.kind] as Array<string | number>;
  const eventValues = new Map(Object.entries(descriptor.eventValues).map(([name, type]) => [name, { type }]));
  for (const input of context.ir.inputs) {
    if (input.config.required === true && trigger.with[input.name] === undefined) {
      addDiagnostic(context, "trigger.required", `Trigger must bind required input "${input.name}"`, [...path, "with", input.name]);
    }
  }
  for (const [inputName, value] of Object.entries(trigger.with)) {
    const input = context.inputs.get(inputName);
    if (!input) continue;
    const bindingPath = [...path, "with", inputName];
    const actual = resolveTriggerBindingType(value, bindingPath, eventValues, context);
    if (actual && !typesCompatible(input.type, actual.type)) {
      addDiagnostic(context, "trigger.type", `Trigger value has type ${actual.type}, expected ${input.type}`, bindingPath);
    }
  }
};

const bindTriggers = (context: BindingContext): void => {
  const descriptors = new Map(mailWorkflowManifest.triggers.map((trigger) => [trigger.kind, trigger]));
  for (const trigger of context.ir.triggers) {
    const descriptor = descriptors.get(trigger.kind);
    if (descriptor) bindTrigger(trigger, descriptor, context);
  }
};

export const bindMailWorkflow = async (ir: WorkflowIr, catalog: MailWorkflowCatalog): Promise<BindMailWorkflowResult> => {
  if (ir.languageId !== mailWorkflowManifest.id || ir.languageVersion !== mailWorkflowManifest.version) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "binding.language",
          message: `Expected ${mailWorkflowManifest.id}@${mailWorkflowManifest.version}, received ${ir.languageId}@${ir.languageVersion}`,
          severity: "error",
          path: [],
        },
      ],
    };
  }
  const context: BindingContext = { ir, catalog, inputs: new Map(), bindings: {}, diagnostics: [] };
  bindInputs(context);
  bindTriggers(context);
  bindSteps(ir.steps, new Map(), context);
  if (context.diagnostics.length > 0) return { ok: false, diagnostics: context.diagnostics };

  const plan = await bindWorkflow(ir, mailWorkflowManifest, () => ({
    catalog: snapshotMailWorkflowCatalog(catalog),
    bindings: context.bindings,
  }));
  return { ok: true, plan };
};
