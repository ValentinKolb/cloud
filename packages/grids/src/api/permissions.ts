import type { AuthContext, PermissionLevel } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { Context } from "hono";
import type { Grant, ResolveTarget, ResourceType } from "../service";
import { gridsService } from "../service";

const currentPermissionSubject = (c: Context<AuthContext>) => {
  const actor = c.get("actor") as AuthContext["Variables"]["actor"] | undefined;
  const accessSubject = c.get("accessSubject") as AuthContext["Variables"]["accessSubject"] | undefined;
  const fallbackUser = c.get("user") as AuthContext["Variables"]["user"] | undefined;
  const user = actor ? (actor.kind === "user" ? actor.user : actor.delegatedUser) : fallbackUser;
  return {
    userId: accessSubject?.type === "user" ? accessSubject.userId : (user?.id ?? null),
    userGroups: user?.memberofGroupIds ?? [],
    serviceAccountId:
      actor?.kind === "service_account" ? actor.serviceAccount.id : accessSubject?.type === "service_account" ? accessSubject.serviceAccountId : null,
  };
};

/**
 * Loads grants for the current user and resolves the effective permission
 * for a (base | table | view) target. Returns the effective level or null
 * if the user is denied. Routes typically pass the result to {@link gateAt}.
 */
const effectivePermission = async (c: Context<AuthContext>, target: ResolveTarget): Promise<PermissionLevel> => {
  const subject = currentPermissionSubject(c);
  const grants = await gridsService.permission.loadGrants({
    ...subject,
    baseId: target.baseId,
    tableId: "tableId" in target ? target.tableId : null,
    viewId: "viewId" in target ? target.viewId : null,
    formId: "formId" in target ? target.formId : null,
    documentTemplateId: "documentTemplateId" in target ? target.documentTemplateId : null,
    dashboardId: "dashboardId" in target ? target.dashboardId : null,
    workflowId: "workflowId" in target ? target.workflowId : null,
  });
  return gridsService.permission.resolve(grants, target);
};

/**
 * Returns a Result<void> that's `ok` when the user has at least `required`
 * on the target, or `fail(err.forbidden(...))` otherwise. Routes wrap with
 * `respond(c, ...)` to convert into a 403 response.
 */
export const gateAt = async (
  c: Context<AuthContext>,
  target: ResolveTarget,
  required: PermissionLevel,
): Promise<Result<PermissionLevel>> => {
  const level = await effectivePermission(c, target);
  if (!gridsService.permission.hasAtLeast(level, required)) {
    return fail(err.forbidden("You do not have permission to access this resource."));
  }
  return ok(level);
};

/**
 * Loads the user's grants AND resolves the level in one go. Used by
 * direct-GET handlers that need to distinguish "explicit grant on this
 * resource" from "inherited from parent" — e.g. a personal view is
 * visible to a non-owner only via an explicit view-level grant; the
 * level alone (which may be inherited from table) doesn't tell us.
 */
export const resolveWithGrants = async (
  c: Context<AuthContext>,
  target: ResolveTarget,
): Promise<{ level: PermissionLevel; grants: Grant[] }> => {
  const subject = currentPermissionSubject(c);
  const grants = await gridsService.permission.loadGrants({
    ...subject,
    baseId: target.baseId,
    tableId: "tableId" in target ? target.tableId : null,
    viewId: "viewId" in target ? target.viewId : null,
    formId: "formId" in target ? target.formId : null,
    documentTemplateId: "documentTemplateId" in target ? target.documentTemplateId : null,
    dashboardId: "dashboardId" in target ? target.dashboardId : null,
    workflowId: "workflowId" in target ? target.workflowId : null,
  });
  const level = gridsService.permission.resolve(grants, target);
  return { level, grants };
};

/**
 * True when `grants` carries any explicit ACL row for the given
 * resource.
 */
export const hasExplicitGrant = (grants: Grant[], resourceType: ResourceType, resourceId: string): boolean =>
  gridsService.permission.hasGrantsForResource(grants, resourceType, resourceId);
