import type { WorkflowBoundPlan, WorkflowIr, WorkflowJsonValue, WorkflowLanguageManifest } from "../contracts";
import { hashWorkflowJson, normalizeWorkflowJson } from "./canonical";

export type WorkflowCatalogBinding = {
  catalog: WorkflowJsonValue;
  bindings: Record<string, WorkflowJsonValue>;
};

export type WorkflowCatalogBinder = (ir: Readonly<WorkflowIr>) => WorkflowCatalogBinding | Promise<WorkflowCatalogBinding>;

export const bindWorkflow = async (
  ir: WorkflowIr,
  manifest: WorkflowLanguageManifest,
  bindCatalog: WorkflowCatalogBinder,
): Promise<WorkflowBoundPlan> => {
  if (ir.languageId !== manifest.id || ir.languageVersion !== manifest.version) {
    throw new TypeError(
      `Workflow IR language ${ir.languageId}@${ir.languageVersion} does not match manifest ${manifest.id}@${manifest.version}`,
    );
  }

  const manifestHash = await hashWorkflowJson(manifest);
  if (ir.manifestHash !== manifestHash) {
    throw new TypeError(`Workflow IR manifest hash ${ir.manifestHash} does not match manifest hash ${manifestHash}`);
  }

  const binding = await bindCatalog(ir);
  const catalogHash = await hashWorkflowJson(binding.catalog);
  return {
    schemaVersion: 1,
    languageId: ir.languageId,
    languageVersion: ir.languageVersion,
    sourceHash: ir.sourceHash,
    manifestHash,
    catalogHash,
    ...(manifest.limits?.maxLoopItems !== undefined ? { maxLoopItems: manifest.limits.maxLoopItems } : {}),
    inputs: ir.inputs,
    triggers: ir.triggers,
    steps: ir.steps,
    bindings: normalizeWorkflowJson(binding.bindings),
  };
};
