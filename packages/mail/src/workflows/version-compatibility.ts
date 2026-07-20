import type { WorkflowBoundPlan, WorkflowIrStep } from "@valentinkolb/cloud/workflows";

export type RetiredMailWorkflowConfiguration = "response_schedule_reference" | "reference_scheme_selection";

const retiredStepConfiguration = (steps: WorkflowIrStep[]): RetiredMailWorkflowConfiguration | null => {
  for (const step of steps) {
    if (step.kind === "action") {
      if (step.action === "automaticReply" && typeof step.config.schedule === "string") return "response_schedule_reference";
      if (step.action === "ensureConversationReference" && "scheme" in step.config) return "reference_scheme_selection";
      continue;
    }
    if (step.kind === "if") {
      const nested = retiredStepConfiguration([...step.then, ...step.else]);
      if (nested) return nested;
      continue;
    }
    if (step.kind === "switch") {
      const nested = retiredStepConfiguration([...step.cases.flatMap((entry) => entry.steps), ...step.default]);
      if (nested) return nested;
      continue;
    }
    if (step.kind === "forEach") {
      const nested = retiredStepConfiguration(step.steps);
      if (nested) return nested;
    }
  }
  return null;
};

export const retiredMailWorkflowConfiguration = (plan: WorkflowBoundPlan): RetiredMailWorkflowConfiguration | null => {
  for (const key of Object.keys(plan.bindings)) {
    if (key.endsWith(".automaticReply.schedule")) return "response_schedule_reference";
    if (key.endsWith(".ensureConversationReference.scheme")) return "reference_scheme_selection";
  }
  return retiredStepConfiguration(plan.steps);
};

export const retiredMailWorkflowConfigurationMessage = (kind: RetiredMailWorkflowConfiguration): string =>
  kind === "response_schedule_reference"
    ? "This workflow version uses an obsolete automatic-reply schedule format. Save a new version with inline timing."
    : "This workflow version selects an obsolete reference-number scheme. Save a new version that uses the mailbox reference configuration.";
