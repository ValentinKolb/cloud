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
import {
  bindWorkflow,
  isWorkflowReservedReferenceRoot,
  parseWorkflowValueString,
  resolveWorkflowValuePathDescriptor,
  type WorkflowValuePathDescriptor,
  workflowMessageExpressions,
} from "@valentinkolb/cloud/workflows/language";
import {
  getMailWorkflowCatalogRef,
  type MailWorkflowCatalog,
  type MailWorkflowCatalogEntry,
  type MailWorkflowCatalogIndex,
  snapshotMailWorkflowCatalog,
} from "./catalog";
import { mailWorkflowManifest } from "./manifest";

export type BindMailWorkflowResult = { ok: true; plan: WorkflowBoundPlan } | { ok: false; diagnostics: WorkflowDiagnostic[] };

type ValueInfo = WorkflowValuePathDescriptor & { providerTarget?: string };

type BindingContext = {
  ir: WorkflowIr;
  catalog: MailWorkflowCatalog;
  inputs: Map<string, ValueInfo>;
  bindings: Record<string, WorkflowJsonValue>;
  diagnostics: WorkflowDiagnostic[];
};

const inputTypes = new Map(mailWorkflowManifest.inputs.map((input) => [input.kind, input.valueType]));

const textValue: WorkflowValuePathDescriptor = { kind: "scalar", type: "core.text" };
const booleanValue: WorkflowValuePathDescriptor = { kind: "scalar", type: "core.boolean" };
const dateTimeValue: WorkflowValuePathDescriptor = { kind: "scalar", type: "core.dateTime" };
const mailAddress: WorkflowValuePathDescriptor = {
  kind: "object",
  type: "mail.address",
  properties: { role: textValue, name: textValue, email: textValue },
};
const mailValueDescriptors: Record<string, WorkflowValuePathDescriptor> = {
  "mail.message": {
    kind: "object",
    type: "mail.message",
    properties: {
      id: textValue,
      conversationId: textValue,
      subject: textValue,
      sender: { kind: "array", type: "core.array", items: mailAddress },
      recipients: { kind: "array", type: "core.array", items: mailAddress },
      body: textValue,
      bodyText: textValue,
      bodyHtml: textValue,
      attachments: { kind: "scalar", type: "core.array" },
      hasAttachments: booleanValue,
      folderId: textValue,
      flags: { kind: "array", type: "core.array", items: textValue },
      keywords: { kind: "array", type: "core.array", items: textValue },
      direction: textValue,
      internalDate: dateTimeValue,
      receivedAt: dateTimeValue,
    },
  },
  "mail.conversation": {
    kind: "object",
    type: "mail.conversation",
    properties: {
      id: textValue,
      subject: textValue,
      assigneeUserId: textValue,
      status: textValue,
      workStatus: textValue,
      responseNeeded: booleanValue,
      latestMessageAt: dateTimeValue,
    },
  },
  "mail.context": {
    kind: "object",
    type: "mail.context",
    properties: {
      mailboxId: textValue,
      actor: {
        kind: "object",
        type: "workflow.actor",
        properties: {
          userId: textValue,
          groupIds: { kind: "array", type: "core.array", items: textValue },
          serviceAccountId: textValue,
        },
      },
      occurredAt: dateTimeValue,
    },
  },
};

const valueDescriptor = (type: string): WorkflowValuePathDescriptor => mailValueDescriptors[type] ?? { kind: "scalar", type };

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
  if (parts.length === 0) return value;
  const resolved = resolveWorkflowValuePathDescriptor(value, parts);
  if (resolved) return resolved;
  addDiagnostic(context, "reference.path", `Reference "${reference}" does not expose path "${parts.join(".")}"`, path);
  return null;
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
    value = mailValueDescriptors["mail.context"]!;
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
      return resolveReference(parsed.expression.reference, path, scope, context) ?? valueDescriptor("core.value");
    } else if (parsed.kind === "expression") return dateTimeValue;
    return textValue;
  }
  if (typeof value === "number") return valueDescriptor("core.number");
  if (typeof value === "boolean") return booleanValue;
  if (value === null) return valueDescriptor("core.null");
  if (Array.isArray(value)) {
    const elements = value.map((item, index) => bindValue(item, [...path, index], scope, context));
    return { kind: "array", type: "core.array", items: valueDescriptor("core.value"), elements };
  }
  const properties = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bindValue(item, [...path, key], scope, context)]));
  return { kind: "object", type: "core.object", properties };
};

const expectReference = (
  value: WorkflowJsonValue | undefined,
  expectedType: string,
  label: string,
  path: Array<string | number>,
  scope: ReadonlyMap<string, ValueInfo>,
  context: BindingContext,
): ValueInfo | null => {
  if (typeof value !== "string") return null;
  const source = expressionReference(value);
  if (!source) {
    addDiagnostic(context, "reference.invalid", `${label} must be a value reference`, path);
    return null;
  }
  const actual = resolveReference(source.value, path, scope, context);
  if (actual && actual.type !== expectedType) {
    addDiagnostic(context, "reference.type", `${label} references ${actual.type}, expected ${expectedType}`, path);
    return null;
  }
  return actual;
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
  } else if (resolveReference(source.value, path, scope, context)) {
    addDiagnostic(context, "binding.dynamic", `${label} must be a literal accessible name or ID`, path);
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
  if (isWorkflowReservedReferenceRoot(name) || scope.has(name)) {
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

const bindAction = (
  step: Extract<WorkflowIrStep, { kind: "action" }>,
  scope: Map<string, ValueInfo>,
  providerTargets: Set<string>,
  context: BindingContext,
): void => {
  const path = [...step.sourcePath, step.action];
  const config = step.config;
  if (step.action === "addKeyword" || step.action === "removeKeyword") {
    const message = expectReference(config.message, "mail.message", "message", [...path, "message"], scope, context);
    if (message?.providerTarget) {
      if (providerTargets.has(message.providerTarget)) {
        addDiagnostic(context, "action.sequence", "Multiple provider mutations of the same message are not supported", path);
      }
      providerTargets.add(message.providerTarget);
    }
    if (config.keyword !== undefined) bindValue(config.keyword, [...path, "keyword"], scope, context);
  } else if (step.action === "moveMessage") {
    const message = expectReference(config.message, "mail.message", "message", [...path, "message"], scope, context);
    if (message?.providerTarget) {
      if (providerTargets.has(message.providerTarget)) {
        addDiagnostic(context, "action.sequence", "Multiple provider mutations of the same message are not supported", path);
      }
      providerTargets.add(message.providerTarget);
    }
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

const bindSteps = (steps: WorkflowIrStep[], scope: Map<string, ValueInfo>, providerTargets: Set<string>, context: BindingContext): void => {
  for (const step of steps) {
    if (step.kind === "action") bindAction(step, scope, providerTargets, context);
    else if (step.kind === "if") {
      bindCondition(step.condition, [...step.sourcePath, "if"], scope, context);
      const thenTargets = new Set(providerTargets);
      const elseTargets = new Set(providerTargets);
      bindSteps(step.then, new Map(scope), thenTargets, context);
      bindSteps(step.else, new Map(scope), elseTargets, context);
      for (const target of [...thenTargets, ...elseTargets]) providerTargets.add(target);
    } else if (step.kind === "switch") {
      bindValue(step.value, [...step.sourcePath, "switch"], scope, context);
      const branchTargets: Set<string>[] = [];
      step.cases.forEach((item, index) => {
        bindValue(item.when, [...step.sourcePath, "cases", index, "when"], scope, context);
        const caseTargets = new Set(providerTargets);
        bindSteps(item.steps, new Map(scope), caseTargets, context);
        branchTargets.push(caseTargets);
      });
      const defaultTargets = new Set(providerTargets);
      bindSteps(step.default, new Map(scope), defaultTargets, context);
      for (const target of [...defaultTargets, ...branchTargets.flatMap((targets) => [...targets])]) providerTargets.add(target);
    } else {
      addDiagnostic(context, "step.unsupported", "forEach is not supported by the Mail workflow vocabulary", [
        ...step.sourcePath,
        "forEach",
      ]);
    }
  }
};

const bindInputs = (context: BindingContext): void => {
  for (const input of context.ir.inputs) {
    const descriptor = valueDescriptor(inputTypes.get(input.type) ?? "core.value");
    context.inputs.set(input.name, {
      ...descriptor,
      ...(descriptor.type === "mail.message" ? { providerTarget: "mail.target.message" } : {}),
    });
  }
};

const typesCompatible = (expected: string, actual: string): boolean =>
  expected === actual || expected === "core.value" || (expected === "core.dateTime" && actual === "core.text");

const resolveTriggerBindingType = (
  value: WorkflowJsonValue,
  bindingPath: Array<string | number>,
  eventValues: ReadonlyMap<string, ValueInfo>,
  context: BindingContext,
): ValueInfo | null => {
  if (typeof value !== "string") return valueDescriptor("core.value");
  const parsed = parseWorkflowValueString(value);
  if (parsed.kind === "invalid") {
    addDiagnostic(context, "reference.invalid", "Invalid trigger binding expression", bindingPath);
    return null;
  }
  if (parsed.kind !== "expression") return textValue;
  if (parsed.expression.kind !== "reference") return dateTimeValue;
  return resolveReference(parsed.expression.reference, bindingPath, new Map(), context, eventValues);
};

const bindTrigger = (
  trigger: WorkflowIr["triggers"][number],
  descriptor: (typeof mailWorkflowManifest.triggers)[number],
  context: BindingContext,
): void => {
  const path = ["triggers", trigger.kind] as Array<string | number>;
  const eventValues = new Map(Object.entries(descriptor.eventValues).map(([name, type]) => [name, valueDescriptor(type)]));
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
  bindSteps(ir.steps, new Map(), new Set(), context);
  if (context.diagnostics.length > 0) return { ok: false, diagnostics: context.diagnostics };

  const plan = await bindWorkflow(ir, mailWorkflowManifest, () => ({
    catalog: snapshotMailWorkflowCatalog(catalog),
    bindings: context.bindings,
  }));
  return { ok: true, plan };
};
