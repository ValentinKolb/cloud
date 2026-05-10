import type { Context } from "hono";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import type { AuthContext, PermissionLevel } from "@valentinkolb/cloud/server";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import type { ResolveTarget } from "../service";

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
    return fail(err.forbidden(`requires ${required} on this resource`));
  }
  return ok(level);
};
