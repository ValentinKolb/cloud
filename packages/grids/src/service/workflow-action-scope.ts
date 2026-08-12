/**
 * Who a workflow run acts as, and where.
 *
 * A declared action is a static function — it receives a run, not the wiring
 * that started one. So the scope is read back from the run rather than closed
 * over, and it is read from the run *row*: the actor's credential and the
 * authorization it was accepted under are what decide whether the effect is
 * allowed, and neither survives a trip through the event context. A principal
 * rebuilt from `invocation.actor` alone would have no credential at all, and a
 * run started by a read-scoped API token would then act with a session's full
 * authority.
 *
 * When runs move to the kernel this reads `workflows.run` and
 * `grids.workflow_run_profile` instead. One query changes; nothing else does.
 */
import type { WorkflowActionContext } from "@valentinkolb/cloud/workflows";
import { customAppScannerConfigHash } from "../custom-apps/scanner-capability";
import type { GridsWorkflowPrincipal } from "../workflows/contracts";
import type { SqlClient } from "./audit";
import { get as getCustomApp } from "./custom-apps";
import { hasAtLeast, hasGrantsForResource, loadCustomAppGrantsForSubject, resolveEffectivePermission } from "./permission-resolver";
import { ALL_RECORD_ACCESS, type AuthorizedRecordAccess } from "./record-access";
import {
  authorizeWorkflowBase,
  resolveWorkflowBaseRecordAccess,
  revalidateWorkflowPrincipal,
  revalidateWorkflowPrincipalInTransaction,
  workflowPermissionAllows,
  workflowTableBelongsToBase,
} from "./workflow-authorization";
import { getLauncher } from "./workflow-launchers";
import { type GridsWorkflowAuthorization, getWorkflowRunScope } from "./workflow-runs";

export type PermissionLevel = "read" | "write" | "admin";

export type GridsWorkflowActionScope = {
  runId: string;
  baseId: string;
  /** Display identity, for what an email template renders. */
  workflow: { id: string; shortId: string; name: string };
  principal: GridsWorkflowPrincipal;
  authorization: GridsWorkflowAuthorization;
  launcherId: string | null;
};

/**
 * A failure an action can describe, rather than one that escapes it.
 *
 * The code reaches the run view, so an operator can tell a deleted template
 * from a revoked grant; `retryable` says the attempt failed and not the work.
 */
export class GridsWorkflowActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "GridsWorkflowActionError";
  }
}

export const actionError = (code: string, message: string, retryable = false): GridsWorkflowActionError =>
  new GridsWorkflowActionError(code, message, retryable);

export const forbidden = (): GridsWorkflowActionError =>
  actionError("FORBIDDEN", "Workflow actor does not have permission for this action");

/** A service `Result` refused: its own code and status decide how it is reported. */
export const requireOk = <T>(
  result: { ok: true; data: T } | { ok: false; error: { code: string; message: string; status?: number } },
): T => {
  if (result.ok) return result.data;
  const { code, message, status } = result.error;
  throw actionError(code || "GRIDS_ACTION_FAILED", message, status !== undefined && status >= 500);
};

export const workflowRunScope = (ctx: Pick<WorkflowActionContext, "runId">, client?: SqlClient): Promise<GridsWorkflowActionScope> =>
  getWorkflowRunScope(ctx.runId, client).then((scope) => {
    if (!scope) throw actionError("NOT_FOUND", "Workflow run is no longer available");
    return scope;
  });

/** What deciding "may this run execute" needs, whether or not a run row exists yet. */
export type GridsWorkflowExecutionClaim = {
  baseId: string;
  workflowId: string;
  principal: GridsWorkflowPrincipal;
  authorization: GridsWorkflowAuthorization;
  launcherId: string | null | undefined;
};

/**
 * Whether this actor may still execute this workflow.
 *
 * An indirectly launched run is authorized by the published surface that
 * launched it, not by a grant on the workflow. The surface, action and launcher
 * must still agree at effect time because any of them can change while a run is
 * queued.
 */
export const canExecuteWorkflow = async (claim: GridsWorkflowExecutionClaim, client?: SqlClient): Promise<boolean> => {
  const { authorization } = claim;
  if (authorization.kind === "workflow") {
    return authorizeWorkflowBase(claim.principal, claim.baseId, "write", client);
  }
  const revalidated = client
    ? await revalidateWorkflowPrincipalInTransaction(claim.principal, claim.baseId, client)
    : await revalidateWorkflowPrincipal(claim.principal, claim.baseId);
  if (!revalidated.ok || !workflowPermissionAllows(revalidated.permissionCap, "write")) return false;
  if (!claim.launcherId) return false;
  if (authorization.kind === "custom-app-action" || authorization.kind === "custom-app-sidebar-action") {
    const [app, launcher] = await Promise.all([getCustomApp(authorization.customAppId, client), getLauncher(claim.launcherId, client)]);
    if (
      !app?.publishedDefinition ||
      !app.publishedCapabilities ||
      app.baseId !== claim.baseId ||
      !launcher ||
      launcher.baseId !== claim.baseId ||
      launcher.workflowId !== claim.workflowId ||
      launcher.config.kind !== "customApp" ||
      !launcher.enabled ||
      launcher.validatedRevision !== authorization.revision ||
      launcher.diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ) {
      return false;
    }
    const grants = await loadCustomAppGrantsForSubject({ subject: revalidated.subject, customAppId: app.id }, client);
    if (
      !hasGrantsForResource(grants, "customApp", app.id) ||
      !hasAtLeast(resolveEffectivePermission(grants, { customAppId: app.id }), "read")
    ) {
      return false;
    }
    if (authorization.kind === "custom-app-sidebar-action") {
      const action = app.publishedDefinition.sidebar?.actions.find(
        (candidate) => candidate.id === authorization.actionId && candidate.kind === "workflow",
      );
      if (!action || action.kind !== "workflow" || action.launcherId !== claim.launcherId) return false;
      return app.publishedCapabilities.workflowLaunchers.some(
        (capability) =>
          "sidebarActionId" in capability &&
          capability.sidebarActionId === action.id &&
          capability.launcherId === claim.launcherId &&
          capability.workflowId === claim.workflowId &&
          capability.revision === authorization.revision,
      );
    }
    const page = app.publishedDefinition.pages.find((candidate) => candidate.id === authorization.pageId);
    const block = page?.rows
      .flatMap((row) => row.columns.flatMap((column) => column.blocks))
      .find((candidate) => candidate.id === authorization.blockId && (candidate.type === "actions" || candidate.type === "records"));
    const action =
      block?.type === "actions"
        ? block.actions.find((candidate) => candidate.id === authorization.actionId)
        : block?.type === "records"
          ? block.rowActions?.find((candidate) => candidate.id === authorization.actionId)
          : null;
    if (!action || action.kind !== "workflow" || action.launcherId !== claim.launcherId) return false;
    return app.publishedCapabilities.workflowLaunchers.some(
      (capability) =>
        "pageId" in capability &&
        capability.pageId === page!.id &&
        capability.blockId === block!.id &&
        capability.actionId === action.id &&
        capability.launcherId === claim.launcherId &&
        capability.workflowId === claim.workflowId &&
        capability.revision === authorization.revision,
    );
  }
  if (authorization.kind === "custom-app-scanner") {
    const [app, launcher] = await Promise.all([getCustomApp(authorization.customAppId, client), getLauncher(claim.launcherId, client)]);
    if (
      !app?.publishedDefinition ||
      !app.publishedCapabilities ||
      app.baseId !== claim.baseId ||
      !launcher ||
      launcher.baseId !== claim.baseId ||
      launcher.workflowId !== claim.workflowId ||
      launcher.config.kind !== "scanner" ||
      !launcher.enabled ||
      launcher.validatedRevision !== authorization.revision ||
      launcher.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
      customAppScannerConfigHash(launcher.config) !== authorization.configHash
    ) {
      return false;
    }
    const grants = await loadCustomAppGrantsForSubject({ subject: revalidated.subject, customAppId: app.id }, client);
    if (
      !hasGrantsForResource(grants, "customApp", app.id) ||
      !hasAtLeast(resolveEffectivePermission(grants, { customAppId: app.id }), "read")
    ) {
      return false;
    }
    const page = app.publishedDefinition.pages.find((candidate) => candidate.id === authorization.pageId);
    const block = page?.rows
      .flatMap((row) => row.columns.flatMap((column) => column.blocks))
      .find((candidate) => candidate.id === authorization.blockId);
    if (!block || block.type !== "scanner" || block.launcherId !== claim.launcherId) return false;
    return app.publishedCapabilities.scannerLaunchers.some(
      (capability) =>
        capability.pageId === page!.id &&
        capability.blockId === block.id &&
        capability.launcherId === claim.launcherId &&
        capability.workflowId === claim.workflowId &&
        capability.revision === authorization.revision &&
        capability.configHash === authorization.configHash,
    );
  }
  return false;
};

export const canExecuteRun = (scope: GridsWorkflowActionScope, client?: SqlClient): Promise<boolean> =>
  canExecuteWorkflow({ ...scope, workflowId: scope.workflow.id }, client);

export const resolveWorkflowExecutionRecordAccess = async (
  claim: GridsWorkflowExecutionClaim,
  tableId: string,
  required: PermissionLevel,
  client?: SqlClient,
): Promise<AuthorizedRecordAccess | null> => {
  if (claim.authorization.kind === "workflow") {
    return resolveWorkflowBaseRecordAccess(claim.principal, { baseId: claim.baseId, tableId }, required, client);
  }
  if (!(await workflowTableBelongsToBase(claim.baseId, tableId, client))) return null;
  return (await canExecuteWorkflow(claim, client)) ? ALL_RECORD_ACCESS : null;
};

export const requireExecution = async (scope: GridsWorkflowActionScope, client?: SqlClient): Promise<void> => {
  if (!(await canExecuteRun(scope, client))) throw forbidden();
};

export const requirePermission = async (scope: GridsWorkflowActionScope, required: PermissionLevel, client?: SqlClient): Promise<void> => {
  const allowed =
    scope.authorization.kind !== "workflow"
      ? await canExecuteRun(scope, client)
      : await authorizeWorkflowBase(scope.principal, scope.baseId, required, client);
  if (!allowed) throw forbidden();
};

export const resolveWorkflowRunRecordAccess = async (
  scope: GridsWorkflowActionScope,
  tableId: string,
  required: PermissionLevel,
  client?: SqlClient,
): Promise<AuthorizedRecordAccess | null> => {
  return resolveWorkflowExecutionRecordAccess({ ...scope, workflowId: scope.workflow.id }, tableId, required, client);
};

export const requireRecordAccess = async (
  scope: GridsWorkflowActionScope,
  tableId: string,
  required: PermissionLevel,
  client?: SqlClient,
): Promise<AuthorizedRecordAccess> => {
  const access = await resolveWorkflowRunRecordAccess(scope, tableId, required, client);
  if (!access) throw forbidden();
  return access;
};

/** Provenance an audit entry carries, so a write can be traced back to its credential. */
export const workflowAuditMeta = (scope: GridsWorkflowActionScope) => ({
  workflowId: scope.workflow.id,
  workflowRunId: scope.runId,
  actorServiceAccountId: scope.principal.actorServiceAccountId ?? null,
  credentialId: scope.principal.credential?.id ?? null,
  credentialKind: scope.principal.credential?.kind ?? null,
  credentialScopes: scope.principal.credential?.scopes ?? [],
  credentialPermissionCap: scope.principal.credential?.permissionCap ?? null,
  credentialResourceBinding: scope.principal.credential?.resourceBinding ?? null,
});

export const actorId = (scope: GridsWorkflowActionScope): string | null => scope.principal.userId;
