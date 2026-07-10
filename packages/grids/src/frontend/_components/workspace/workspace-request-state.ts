import type { DocumentTemplate } from "../../../contracts";
import type { Base, Table, Workflow } from "../../../service";
import { gridsService } from "../../../service";
import { canUseEditModeForCatalog, loadCatalog } from "./workspace-catalog-state";
import { documentTemplateLevelForUser, resolveBaseLevel, viewLevelForUser, workflowLevelForUser } from "./workspace-state-access";
import { buildChrome } from "./workspace-state-helpers";
import type { GridsWorkspaceState, LoadWorkspaceParams, WorkspaceCommon } from "./workspace-state-model";

export type WorkspaceRequestContext = {
  common: WorkspaceCommon;
  requestedDocumentTable: Table | null;
  requestedDocumentTemplate: DocumentTemplate | null;
  requestedWorkflow: Workflow | null;
  requestedViewTable: Table | null;
};

export const loadWorkspaceRequest = async (
  params: LoadWorkspaceParams,
  base: Base,
): Promise<WorkspaceRequestContext | Extract<GridsWorkspaceState, { kind: "accessDenied" }>> => {
  const level = await resolveBaseLevel(params.user, base.id);
  const catalog = await loadCatalog(base.id, params.user);
  const hasBaseRead = gridsService.permission.hasAtLeast(level, "read");
  const requestedDocumentTable =
    params.activeDocumentTableSlug && params.activeDocumentTemplateSlug
      ? await gridsService.table.getByIdOrShortId(base.id, params.activeDocumentTableSlug)
      : null;
  const requestedDocumentTemplate =
    requestedDocumentTable && params.activeDocumentTemplateSlug
      ? await gridsService.document.getTemplateByIdOrShortId(requestedDocumentTable.id, params.activeDocumentTemplateSlug)
      : null;
  const requestedWorkflow = params.activeWorkflowSlug
    ? await gridsService.workflow.getByIdOrShortId(base.id, params.activeWorkflowSlug)
    : null;
  const requestedViewTable =
    params.activeTableSlug && params.activeViewSlug ? await gridsService.table.getByIdOrShortId(base.id, params.activeTableSlug) : null;
  const requestedView =
    requestedViewTable && params.activeViewSlug
      ? await gridsService.view.getByIdOrShortId(requestedViewTable.id, params.activeViewSlug)
      : null;

  const hasDocumentTemplateRouteAccess = requestedDocumentTemplate
    ? gridsService.permission.hasAtLeast(
        await documentTemplateLevelForUser(params.user, base.id, requestedDocumentTemplate.tableId, requestedDocumentTemplate.id),
        "read",
      )
    : false;
  const hasWorkflowRouteAccess = requestedWorkflow
    ? gridsService.permission.hasAtLeast(await workflowLevelForUser(params.user, base.id, requestedWorkflow.id), "read")
    : false;
  const hasViewRouteAccess = requestedView
    ? gridsService.permission.hasAtLeast(await viewLevelForUser(params.user, base.id, requestedView.tableId, requestedView.id), "read")
    : false;
  if (
    !hasBaseRead &&
    catalog.sidebarForms.length === 0 &&
    !hasViewRouteAccess &&
    catalog.sidebarDocumentTemplates.length === 0 &&
    !hasDocumentTemplateRouteAccess &&
    !hasWorkflowRouteAccess &&
    catalog.workflows.length === 0
  ) {
    return { kind: "accessDenied", title: "Access denied", message: "No access to this base" };
  }

  const canManageBase = gridsService.permission.hasAtLeast(level, "admin");
  const canCreateTables = gridsService.permission.hasAtLeast(level, "write");
  return {
    common: {
      params,
      base,
      chrome: buildChrome(params.href, base),
      catalog,
      canManageBase,
      canCreateTables,
      canUseEditMode: canUseEditModeForCatalog(catalog, params.user, canManageBase, canCreateTables),
      canUseQueryWorkspace: hasBaseRead,
    },
    requestedDocumentTable,
    requestedDocumentTemplate,
    requestedWorkflow,
    requestedViewTable,
  };
};
