import type { Workflow } from "../../../contracts";

export type WorkflowEditorDraft = {
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  revision: number;
};

export const workflowEditorDraft = (workflow: Workflow | undefined, fallbackSource: string): WorkflowEditorDraft => ({
  name: workflow?.name ?? "",
  description: workflow?.description ?? "",
  enabled: workflow?.enabled ?? false,
  source: workflow?.source ?? fallbackSource,
  revision: workflow?.revision ?? 1,
});
