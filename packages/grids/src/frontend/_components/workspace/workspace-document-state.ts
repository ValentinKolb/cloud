import type { DocumentTemplate } from "../../../contracts";
import type { Table } from "../../../service";
import { gridsService } from "../../../service";
import { documentTemplateLevelForUser } from "./workspace-state-access";
import { okState } from "./workspace-state-helpers";
import type { GridsWorkspaceState, OkWorkspaceState, WorkspaceCommon } from "./workspace-state-model";

export const loadDocumentTemplateState = async (
  common: WorkspaceCommon,
  table: Table,
  template: DocumentTemplate,
): Promise<OkWorkspaceState | Extract<GridsWorkspaceState, { kind: "accessDenied" }>> => {
  const level = await documentTemplateLevelForUser(common.params.user, common.base.id, table.id, template.id);
  if (!gridsService.permission.hasAtLeast(level, "read")) {
    return { kind: "accessDenied", title: "Access denied", message: "No access to this document template" };
  }
  const canWriteTemplate = gridsService.permission.hasAtLeast(level, "write");
  const canManageTemplate = gridsService.permission.hasAtLeast(level, "admin");
  return okState(
    common,
    {
      kind: "documentTemplate",
      table,
      template: gridsService.document.summarizeTemplate(template),
      editableTemplate: canManageTemplate ? template : null,
      canWriteTemplate,
      canManageTemplate,
      activeTemplateAccessEntries: canManageTemplate ? await gridsService.access.listForDocumentTemplate(template.id) : [],
      initialRecordId: common.chrome.url.searchParams.get("record"),
      initialDocumentViewMode: common.params.initialDocumentViewMode ?? "list",
    },
    [...common.chrome.titleBase, { title: "Documents" }, { title: template.name }],
  );
};
