import type { AuthContext, PermissionLevel } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { Context } from "hono";
import type { Grant, ResolveTarget, ResourceType } from "../service";
import { gridsService } from "../service";

const PERMISSION_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

const permissionFromCredentialScopes = (scopes: readonly string[]): PermissionLevel => {
  if (scopes.includes("admin") || scopes.includes("grids:admin") || scopes.includes("grids:*")) return "admin";
  if (scopes.includes("write") || scopes.includes("grids:write")) return "write";
  if (scopes.includes("read") || scopes.includes("grids:read")) return "read";
  return "none";
};

const minPermission = (left: PermissionLevel, right: PermissionLevel): PermissionLevel =>
  PERMISSION_RANK[left] <= PERMISSION_RANK[right] ? left : right;

const currentActor = <T extends AuthContext>(c: Context<T>) => c.get("actor") as AuthContext["Variables"]["actor"] | undefined;

export const currentActorUser = <T extends AuthContext>(c: Context<T>) => {
  const actor = currentActor(c);
  return actor?.kind === "user" ? actor.user : (actor?.delegatedUser ?? null);
};

export const currentActorUserId = <T extends AuthContext>(c: Context<T>) => currentActorUser(c)?.id ?? null;

const currentPermissionSubject = <T extends AuthContext>(c: Context<T>) => {
  const accessSubject = c.get("accessSubject") as AuthContext["Variables"]["accessSubject"] | undefined;
  const user = currentActorUser(c);
  return {
    userId: accessSubject?.type === "user" ? accessSubject.userId : (user?.id ?? null),
    userGroups: user?.memberofGroupIds ?? [],
    serviceAccountId: accessSubject?.type === "service_account" ? accessSubject.serviceAccountId : null,
  };
};

/**
 * Returns the bound base for a valid Grids resource credential. `undefined`
 * means the request is not resource-bound; `null` means the credential is
 * bound to another app or resource type and is invalid for Grids.
 */
export const currentResourceBoundBaseId = <T extends AuthContext>(c: Context<T>): string | null | undefined => {
  const actor = currentActor(c);
  if (actor?.kind !== "service_account" || actor.serviceAccount.kind !== "resource_bound") return undefined;
  const serviceAccount = actor.serviceAccount;
  return serviceAccount.appId === "grids" && serviceAccount.resourceType === "base" ? serviceAccount.resourceId : null;
};

const credentialPermission = <T extends AuthContext>(c: Context<T>): PermissionLevel => {
  const actor = currentActor(c);
  return actor?.kind === "service_account" ? permissionFromCredentialScopes(actor.scopes) : "admin";
};

const targetMatchesResourceBinding = <T extends AuthContext>(c: Context<T>, target: ResolveTarget): boolean => {
  const boundBaseId = currentResourceBoundBaseId(c);
  return boundBaseId === undefined || boundBaseId === target.baseId;
};

const loadCurrentGrants = (c: Context<AuthContext>, target: ResolveTarget): Promise<Grant[]> => {
  const subject = currentPermissionSubject(c);
  return gridsService.permission.loadGrants({
    ...subject,
    baseId: target.baseId,
    tableId: "tableId" in target ? target.tableId : null,
    viewId: "viewId" in target ? target.viewId : null,
    formId: "formId" in target ? target.formId : null,
    documentTemplateId: "documentTemplateId" in target ? target.documentTemplateId : null,
    dashboardId: "dashboardId" in target ? target.dashboardId : null,
    workflowId: "workflowId" in target ? target.workflowId : null,
  });
};

export const gateCredentialScope = async <T extends AuthContext>(
  c: Context<T>,
  required: PermissionLevel,
  options: { allowResourceBound?: boolean } = {},
): Promise<Result<PermissionLevel>> => {
  const level = credentialPermission(c);
  if (PERMISSION_RANK[level] < PERMISSION_RANK[required]) {
    return fail(err.forbidden("The API credential does not grant the required Grids scope."));
  }
  if (options.allowResourceBound === false && currentResourceBoundBaseId(c) !== undefined) {
    return fail(err.forbidden("Resource-bound API credentials cannot create Grids bases."));
  }
  return ok(level);
};

export const currentActorViewer = <T extends AuthContext>(c: Context<T>) => {
  const subject = currentPermissionSubject(c);
  return {
    userId: subject.userId,
    userGroups: subject.userGroups,
    serviceAccountId: subject.serviceAccountId,
  };
};

/**
 * Loads grants for the current user and resolves the effective permission
 * for a (base | table | view) target. Returns the effective level or null
 * if the user is denied. Routes typically pass the result to {@link gateAt}.
 */
const effectivePermission = async (c: Context<AuthContext>, target: ResolveTarget): Promise<PermissionLevel> => {
  if (!targetMatchesResourceBinding(c, target)) return "none";
  const grants = await loadCurrentGrants(c, target);
  return minPermission(gridsService.permission.resolve(grants, target), credentialPermission(c));
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
  if (!targetMatchesResourceBinding(c, target)) return { level: "none", grants: [] };
  const grants = await loadCurrentGrants(c, target);
  const level = minPermission(gridsService.permission.resolve(grants, target), credentialPermission(c));
  return { level, grants };
};

/**
 * True when `grants` carries any explicit ACL row for the given
 * resource.
 */
export const hasExplicitGrant = (grants: Grant[], resourceType: ResourceType, resourceId: string): boolean =>
  gridsService.permission.hasGrantsForResource(grants, resourceType, resourceId);
