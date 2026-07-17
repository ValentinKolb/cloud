import type { AuditRequirement, AuditUpdateRequirement, RecordAuditContext, TableAuditPolicy } from "./contracts";

export type RecordAuditOperation = RecordAuditContext["operation"];

const appliesToUpdate = (requirement: AuditUpdateRequirement, changedFieldIds: string[]): boolean =>
  requirement.enabled &&
  changedFieldIds.length > 0 &&
  (requirement.scope === "all" || changedFieldIds.some((fieldId) => requirement.fieldIds.includes(fieldId)));

export const recordAuditRequirementFor = (
  policy: TableAuditPolicy,
  operation: RecordAuditOperation,
  changedFieldIds: string[] = [],
): AuditRequirement | AuditUpdateRequirement | null => {
  if (operation === "update") {
    const requirement = policy.update;
    return requirement && appliesToUpdate(requirement, changedFieldIds) ? requirement : null;
  }
  const requirement = policy[operation];
  return requirement?.enabled ? requirement : null;
};
