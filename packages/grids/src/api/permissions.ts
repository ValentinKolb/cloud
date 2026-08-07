import { err, fail, ok, type Result } from "@k2b/stdlib";
import type { AccessSubject, AuthContext, PermissionLevel, RequestActor } from "@valentinkolb/cloud/server";
import type { Context } from "hono";
import type { Grant, ResolveTarget, ResourceType } from "../service";
import { gridsService } from "../service";
import type { AuthorizedRecordAccess } from "../service/record-access";
import { workflowCredentialBinding } from "../service/workflow-authorization";
import type { GridsWorkflowPrincipal } from "../workflows/contracts";

const PERMISSION_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

export const permissionFromCredentialScopes = (scopes: readonly string[]): PermissionLevel => {
  if (scopes.includes("admin") || scopes.includes("grids:admin") || scopes.includes("grids:*")) return "admin";
  if (scopes.includes("write") || scopes.includes("grids:write")) return "write";
  if (scopes.includes("read") || scopes.includes("grids:read")) return "read";
  return "none";
};

export const minPermission = (left: PermissionLevel, right: PermissionLevel): PermissionLevel =>
  PERMISSION_RANK[left] <= PERMISSION_RANK[right] ? left : right;

export type GridsAccessContext = {
  actor: RequestActor | undefined;
  accessSubject: AccessSubject | null;
};

export const gridsAccessContext = <T extends AuthContext>(c: Context<T>): GridsAccessContext => ({
  actor: c.get("actor") as AuthContext["Variables"]["actor"] | undefined,
  accessSubject: (c.get("accessSubject") as AuthContext["Variables"]["accessSubject"] | undefined) ?? null,
});

const actorUser = (access: GridsAccessContext) => {
  const actor = access.actor;
  if (!actor) return null;
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

export const accessActorUser = (access: GridsAccessContext) => actorUser(access);

export const currentActorUser = <T extends AuthContext>(c: Context<T>) => actorUser(gridsAccessContext(c));

export const currentActorUserId = <T extends AuthContext>(c: Context<T>) => currentActorUser(c)?.id ?? null;

export const accessSubjectFor = (access: GridsAccessContext): AccessSubject | null => {
  const user = actorUser(access);
  if (access.accessSubject) return access.accessSubject;
  return user ? { type: "user", userId: user.id } : null;
};

export const currentAccessSubject = <T extends AuthContext>(c: Context<T>): AccessSubject | null => accessSubjectFor(gridsAccessContext(c));

/**
 * Returns the bound base for a valid Grids resource credential. `undefined`
 * means the request is not resource-bound; `null` means the credential is
 * bound to another app or resource type and is invalid for Grids.
 */
export const resourceBoundBaseIdFor = (access: GridsAccessContext): string | null | undefined => {
  const actor = access.actor;
  if (actor?.kind !== "service_account" || actor.serviceAccount.kind !== "resource_bound") return undefined;
  const serviceAccount = actor.serviceAccount;
  return serviceAccount.appId === "grids" && serviceAccount.resourceType === "base" ? serviceAccount.resourceId : null;
};

export const currentResourceBoundBaseId = <T extends AuthContext>(c: Context<T>): string | null | undefined =>
  resourceBoundBaseIdFor(gridsAccessContext(c));

export const credentialPermissionFor = (access: GridsAccessContext): PermissionLevel => {
  const actor = access.actor;
  return actor?.kind === "service_account" ? permissionFromCredentialScopes(actor.scopes) : "admin";
};

export const currentCredentialPermission = <T extends AuthContext>(c: Context<T>): PermissionLevel =>
  credentialPermissionFor(gridsAccessContext(c));

const targetMatchesResourceBinding = (access: GridsAccessContext, target: ResolveTarget): boolean => {
  const boundBaseId = resourceBoundBaseIdFor(access);
  return boundBaseId === undefined || boundBaseId === target.baseId;
};

const loadCurrentGrants = (access: GridsAccessContext, target: ResolveTarget): Promise<Grant[]> => {
  const subject = accessSubjectFor(access);
  return gridsService.permission.loadGrants({
    userId: subject?.type === "user" ? subject.userId : null,
    serviceAccountId: subject?.type === "service_account" ? subject.serviceAccountId : null,
    baseId: target.baseId,
    tableId: "tableId" in target ? target.tableId : null,
    viewId: "viewId" in target ? target.viewId : null,
    formId: "formId" in target ? target.formId : null,
    documentTemplateId: "documentTemplateId" in target ? target.documentTemplateId : null,
    customAppId: "customAppId" in target ? target.customAppId : null,
    workflowId: "workflowId" in target ? target.workflowId : null,
  });
};

export const gateCredentialScopeFor = async (
  access: GridsAccessContext,
  required: PermissionLevel,
  options: { allowResourceBound?: boolean } = {},
): Promise<Result<PermissionLevel>> => {
  const level = credentialPermissionFor(access);
  if (PERMISSION_RANK[level] < PERMISSION_RANK[required]) {
    return fail(err.forbidden("The API credential does not grant the required Grids scope."));
  }
  if (options.allowResourceBound === false && resourceBoundBaseIdFor(access) !== undefined) {
    return fail(err.forbidden("Resource-bound API credentials cannot create Grids bases."));
  }
  return ok(level);
};

export const gateCredentialScope = <T extends AuthContext>(
  c: Context<T>,
  required: PermissionLevel,
  options: { allowResourceBound?: boolean } = {},
) => gateCredentialScopeFor(gridsAccessContext(c), required, options);

export const actorViewerFor = (access: GridsAccessContext) => {
  const subject = accessSubjectFor(access);
  const user = actorUser(access);
  return {
    userId: subject?.type === "user" ? subject.userId : null,
    userGroups: user?.memberofGroupIds ?? [],
    serviceAccountId: subject?.type === "service_account" ? subject.serviceAccountId : null,
  };
};

export const currentActorViewer = <T extends AuthContext>(c: Context<T>) => actorViewerFor(gridsAccessContext(c));

export const currentWorkflowPrincipal = <T extends AuthContext>(c: Context<T>): GridsWorkflowPrincipal => {
  const actor = gridsAccessContext(c).actor;
  const viewer = currentActorViewer(c);
  if (!actor || actor.kind === "user") {
    return {
      userId: viewer.userId,
      groupIds: viewer.userGroups,
      serviceAccountId: viewer.serviceAccountId,
      actorServiceAccountId: null,
      credential: null,
    };
  }
  const credentialId = actor.credentialId ?? null;
  return {
    userId: viewer.userId,
    groupIds: viewer.userGroups,
    serviceAccountId: viewer.serviceAccountId,
    actorServiceAccountId: actor.serviceAccount.id,
    credential: {
      kind: credentialId ? "api_token" : "oauth",
      id: credentialId,
      scopes: [...actor.scopes],
      permissionCap: permissionFromCredentialScopes(actor.scopes),
      expiresAt: actor.credentialExpiresAt ?? null,
      resourceBinding: workflowCredentialBinding(actor.serviceAccount),
    },
  };
};

/**
 * Loads grants for the current user and resolves the effective permission
 * for a (base | table | view) target. Returns the effective level or null
 * if the user is denied. Routes typically pass the result to {@link gateAt}.
 */
const effectivePermission = async (access: GridsAccessContext, target: ResolveTarget): Promise<PermissionLevel> => {
  if (!targetMatchesResourceBinding(access, target)) return "none";
  const grants = await loadCurrentGrants(access, target);
  return minPermission(gridsService.permission.resolve(grants, target), credentialPermissionFor(access));
};

/**
 * Returns a Result<void> that's `ok` when the user has at least `required`
 * on the target, or `fail(err.forbidden(...))` otherwise. Routes wrap with
 * `respond(c, ...)` to convert into a 403 response.
 */
export const gateAtAccess = async (
  access: GridsAccessContext,
  target: ResolveTarget,
  required: PermissionLevel,
): Promise<Result<PermissionLevel>> => {
  const level = await effectivePermission(access, target);
  if (!gridsService.permission.hasAtLeast(level, required)) {
    return fail(err.forbidden("You do not have permission to access this resource."));
  }
  return ok(level);
};

export const gateAt = (c: Context<AuthContext>, target: ResolveTarget, required: PermissionLevel): Promise<Result<PermissionLevel>> =>
  gateAtAccess(gridsAccessContext(c), target, required);

export const resolveRecordAccessForAccess = async (
  access: GridsAccessContext,
  target: ResolveTarget,
  required: PermissionLevel,
): Promise<Result<{ level: PermissionLevel; recordAccess: AuthorizedRecordAccess }>> => {
  if (!targetMatchesResourceBinding(access, target)) {
    return fail(err.forbidden("You do not have permission to access this resource."));
  }
  const credentialLevel = credentialPermissionFor(access);
  if (!gridsService.permission.hasAtLeast(credentialLevel, required)) {
    return fail(err.forbidden("The API credential does not grant the required Grids scope."));
  }
  const grants = await loadCurrentGrants(access, target);
  const subject = accessSubjectFor(access);
  const resolved = gridsService.permission.resolveRecordAccess(grants, target, required, subject?.type === "user" ? subject.userId : null);
  const level = minPermission(resolved.level, credentialLevel);
  if (!gridsService.permission.hasAtLeast(level, required) || !resolved.recordAccess) {
    return fail(err.forbidden("You do not have permission to access this resource."));
  }
  return ok({ level, recordAccess: resolved.recordAccess });
};

export const resolveRecordAccess = (c: Context<AuthContext>, target: ResolveTarget, required: PermissionLevel) =>
  resolveRecordAccessForAccess(gridsAccessContext(c), target, required);

/**
 * Loads the user's grants AND resolves the level in one go. Used by
 * direct-GET handlers that need to distinguish "explicit grant on this
 * resource" from "inherited from parent" — e.g. a personal view is
 * visible to a non-owner only via an explicit view-level grant; the
 * level alone (which may be inherited from table) doesn't tell us.
 */
export const resolveWithGrantsForAccess = async (
  access: GridsAccessContext,
  target: ResolveTarget,
): Promise<{ level: PermissionLevel; grants: Grant[] }> => {
  if (!targetMatchesResourceBinding(access, target)) return { level: "none", grants: [] };
  const grants = await loadCurrentGrants(access, target);
  const level = minPermission(gridsService.permission.resolve(grants, target), credentialPermissionFor(access));
  return { level, grants };
};

export const resolveWithGrants = (c: Context<AuthContext>, target: ResolveTarget): Promise<{ level: PermissionLevel; grants: Grant[] }> =>
  resolveWithGrantsForAccess(gridsAccessContext(c), target);

/**
 * True when `grants` carries any explicit ACL row for the given
 * resource.
 */
export const hasExplicitGrant = (grants: Grant[], resourceType: ResourceType, resourceId: string): boolean =>
  gridsService.permission.hasGrantsForResource(grants, resourceType, resourceId);
