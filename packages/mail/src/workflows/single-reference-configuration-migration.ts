import type { WorkflowBoundPlan, WorkflowIr, WorkflowIrStep } from "@valentinkolb/cloud/workflows";
import { parse, stringify } from "yaml";

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

const migrateSourceValue = (value: unknown): number => {
  if (Array.isArray(value)) return value.reduce((count, item) => count + migrateSourceValue(item), 0);
  if (!isObject(value)) return 0;
  let migrated = 0;
  const action = value.ensureConversationReference;
  if (isObject(action) && "scheme" in action) {
    delete action.scheme;
    migrated += 1;
  }
  for (const child of Object.values(value)) migrated += migrateSourceValue(child);
  return migrated;
};

const migrateSteps = (steps: WorkflowIrStep[]): number => {
  let migrated = 0;
  for (const step of steps) {
    if (step.kind === "action" && step.action === "ensureConversationReference" && "scheme" in step.config) {
      delete step.config.scheme;
      migrated += 1;
    } else if (step.kind === "if") {
      migrated += migrateSteps(step.then) + migrateSteps(step.else);
    } else if (step.kind === "switch") {
      for (const item of step.cases) migrated += migrateSteps(item.steps);
      migrated += migrateSteps(step.default);
    } else if (step.kind === "forEach") {
      migrated += migrateSteps(step.steps);
    }
  }
  return migrated;
};

export const removeWorkflowReferenceSchemeSelection = (params: {
  source: string;
  ir: WorkflowIr;
  boundPlan: WorkflowBoundPlan;
}): { source: string; ir: WorkflowIr; boundPlan: WorkflowBoundPlan; migratedActions: number } => {
  const sourceDocument = parse(params.source) as unknown;
  if (!isObject(sourceDocument)) throw new Error("Cannot migrate a non-object Mail workflow source");
  const ir = structuredClone(params.ir);
  const boundPlan = structuredClone(params.boundPlan);
  const sourceCount = migrateSourceValue(sourceDocument);
  const irCount = migrateSteps(ir.steps);
  const planCount = migrateSteps(boundPlan.steps);

  for (const key of Object.keys(boundPlan.bindings)) {
    if (key.endsWith(".ensureConversationReference.scheme")) delete boundPlan.bindings[key];
  }
  if (sourceCount !== irCount || sourceCount !== planCount) {
    throw new Error("Mail reference configuration migration found inconsistent workflow representations");
  }
  return {
    source: sourceCount > 0 ? stringify(sourceDocument, { lineWidth: 0 }) : params.source,
    ir,
    boundPlan,
    migratedActions: sourceCount,
  };
};
