import type { Context } from "hono";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import type { AuthContext, PermissionLevel } from "@valentinkolb/cloud/server";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import type { Grant, ResolveTarget, ResourceType } from "../service";

/**
 * Loads grants for the current user and resolves the effective permission
 * for a (base | table | view) target. Returns the effective level or null
 * if the user is denied. Routes typically pass the result to {@link gateAt}.
 */
export const effectivePermission = async (
  c: Context<AuthContext>,
  target: ResolveTarget,
): Promise<PermissionLevel> => {
  const user = c.get("user");
  // Platform admins bypass per-resource ACLs — same convention as spaces /
  // contacts. Without this, even ops staff couldn't troubleshoot or recover
  // a base they don't own.
  if (hasRole(user, "admin")) return "admin";
  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId: target.baseId,
    tableId: "tableId" in target ? target.tableId : null,
    viewId: "viewId" in target ? target.viewId : null,
    formId: "formId" in target ? target.formId : null,
    dashboardId: "dashboardId" in target ? target.dashboardId : null,
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
 *
 * Platform admins still bypass per-resource ACLs. They get a synthetic
 * "all grants visible" view for the resource, so `hasGrantForResource`
 * always reports true for them — keeps the personal-resource logic
 * uniform.
 */
export const resolveWithGrants = async (
  c: Context<AuthContext>,
  target: ResolveTarget,
): Promise<{ level: PermissionLevel; grants: Grant[] }> => {
  const user = c.get("user");
  if (hasRole(user, "admin")) {
    return { level: "admin", grants: [] };
  }
  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId: target.baseId,
    tableId: "tableId" in target ? target.tableId : null,
    viewId: "viewId" in target ? target.viewId : null,
    formId: "formId" in target ? target.formId : null,
    dashboardId: "dashboardId" in target ? target.dashboardId : null,
  });
  const level = gridsService.permission.resolve(grants, target);
  return { level, grants };
};

/**
 * True when `grants` carries any explicit ACL row for the given
 * resource. Platform admin path returns true unconditionally — admin
 * bypass means "treat as if everything is granted to me".
 */
export const hasExplicitGrant = (
  grants: Grant[],
  isAdmin: boolean,
  resourceType: ResourceType,
  resourceId: string,
): boolean =>
  isAdmin || gridsService.permission.hasGrantsForResource(grants, resourceType, resourceId);
