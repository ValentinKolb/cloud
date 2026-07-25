import type { WorkflowBoundPlan } from "@valentinkolb/cloud/workflows";

export const automaticTriggerSummary = (plan: WorkflowBoundPlan): string | null => {
  const labels = plan.triggers.flatMap((trigger) => {
    if (trigger.kind === "schedule") {
      return [`Schedule ${String(trigger.config.cron ?? "")} (${String(trigger.config.timezone ?? "UTC")})`];
    }
    if (trigger.kind === "recordEvent") {
      const table = typeof trigger.config.table === "string" ? ` in ${trigger.config.table}` : "";
      return [`Record ${String(trigger.config.event ?? "updated")}${table}`];
    }
    return [];
  });
  return labels.length > 0 ? labels.join("\n") : null;
};

export const shouldConfirmAutomaticTriggers = (
  workflow: { enabled: boolean; plan: WorkflowBoundPlan } | undefined,
  nextPlan: WorkflowBoundPlan,
  nextEnabled: boolean,
): boolean => {
  if (!nextEnabled) return false;
  const nextTriggers = automaticTriggerSummary(nextPlan);
  if (!nextTriggers) return false;
  if (!workflow?.enabled) return true;
  const automaticTriggers = (plan: WorkflowBoundPlan) =>
    plan.triggers.filter((trigger) => trigger.kind === "schedule" || trigger.kind === "recordEvent");
  return JSON.stringify(automaticTriggers(nextPlan)) !== JSON.stringify(automaticTriggers(workflow.plan));
};
