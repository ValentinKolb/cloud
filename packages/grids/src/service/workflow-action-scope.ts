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
import type { GridsWorkflowPrincipal } from "../workflows/contracts";
import type { SqlClient } from "./audit";
import { canReadDashboardIncludedData } from "./dashboard-included-access";
import { get as getDashboard } from "./dashboards";
import {
  authorizeWorkflowTarget,
  revalidateWorkflowPrincipal,
  revalidateWorkflowPrincipalInTransaction,
  workflowPermissionAllows,
} from "./workflow-authorization";
import { type GridsWorkflowAuthorization, getWorkflowRunScope } from "./workflow-runs";

export type PermissionLevel = "read" | "write" | "admin";

/** What an action may be asked to act on, beyond the workflow itself. */
export type GridsWorkflowActionTarget = { workflowId: string } | { tableId: string; documentTemplateId?: string };

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
 * A dashboard-launched run is authorized by the widget that launched it, not by
 * a grant on the workflow: whoever can see the dashboard may press its button.
 * That means the dashboard, the widget and the launcher all still have to agree
 * at the moment of the effect, because any of the three can be edited away
 * while the run is queued.
 */
export const canExecuteWorkflow = async (claim: GridsWorkflowExecutionClaim, client?: SqlClient): Promise<boolean> => {
  const { authorization } = claim;
  if (authorization.kind === "workflow") {
    return authorizeWorkflowTarget(claim.principal, { baseId: claim.baseId, workflowId: claim.workflowId }, "write", client);
  }
  const revalidated = client
    ? await revalidateWorkflowPrincipalInTransaction(claim.principal, claim.baseId, client)
    : await revalidateWorkflowPrincipal(claim.principal, claim.baseId);
  if (!revalidated.ok || !workflowPermissionAllows(revalidated.permissionCap, "write")) return false;
  if (!claim.launcherId) return false;
  const dashboard = await getDashboard(authorization.dashboardId, {}, client);
  if (!dashboard || dashboard.baseId !== claim.baseId) return false;
  const readable = await canReadDashboardIncludedData(
    dashboard,
    {
      userId: revalidated.subject.type === "user" ? revalidated.subject.userId : null,
      userGroups: [],
      serviceAccountId: revalidated.subject.type === "service_account" ? revalidated.subject.serviceAccountId : null,
    },
    client,
  );
  if (!readable) return false;
  const widget = dashboard.config.rows.flatMap((row) => row.cells).find((cell) => cell.id === authorization.dashboardWidgetId);
  return widget?.kind === "workflow-button" && widget.launcherId === claim.launcherId;
};

export const canExecuteRun = (scope: GridsWorkflowActionScope, client?: SqlClient): Promise<boolean> =>
  canExecuteWorkflow({ ...scope, workflowId: scope.workflow.id }, client);

export const requireExecution = async (scope: GridsWorkflowActionScope, client?: SqlClient): Promise<void> => {
  if (!(await canExecuteRun(scope, client))) throw forbidden();
};

export const requirePermission = async (
  scope: GridsWorkflowActionScope,
  target: GridsWorkflowActionTarget,
  required: PermissionLevel,
  client?: SqlClient,
): Promise<void> => {
  if (!(await authorizeWorkflowTarget(scope.principal, { baseId: scope.baseId, ...target }, required, client))) throw forbidden();
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
