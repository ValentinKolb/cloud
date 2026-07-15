import type { User } from "@valentinkolb/cloud/contracts";
import type { AccessSubject, PermissionLevel } from "@valentinkolb/cloud/server";
import {
  accounts,
  type ServiceAccount,
  type ServiceAccountCredentialOverview,
  serviceAccountCredentials,
  serviceAccounts,
} from "@valentinkolb/cloud/services";
import type { GridsWorkflowCredential, GridsWorkflowCredentialBinding, GridsWorkflowPrincipal } from "../workflows/contracts";
import { hasAtLeast, loadGrantsForSubject, type ResolveTarget, resolveEffectivePermission } from "./permission-resolver";

const PERMISSION_RANK: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2, admin: 3 };

export const workflowPermissionFromScopes = (scopes: readonly string[]): PermissionLevel => {
  if (scopes.includes("admin") || scopes.includes("grids:admin") || scopes.includes("grids:*")) return "admin";
  if (scopes.includes("write") || scopes.includes("grids:write")) return "write";
  if (scopes.includes("read") || scopes.includes("grids:read")) return "read";
  return "none";
};

const minPermission = (left: PermissionLevel, right: PermissionLevel): PermissionLevel =>
  PERMISSION_RANK[left] <= PERMISSION_RANK[right] ? left : right;

export const workflowPermissionAllows = (actual: PermissionLevel, required: PermissionLevel): boolean =>
  PERMISSION_RANK[actual] >= PERMISSION_RANK[required];

export const workflowCredentialBinding = (serviceAccount: ServiceAccount): GridsWorkflowCredentialBinding | null => {
  if (serviceAccount.kind !== "resource_bound") return null;
  if (!serviceAccount.appId || !serviceAccount.resourceType || !serviceAccount.resourceId) return null;
  return {
    appId: serviceAccount.appId,
    resourceType: serviceAccount.resourceType,
    resourceId: serviceAccount.resourceId,
  };
};

const sameBinding = (left: GridsWorkflowCredentialBinding | null, right: GridsWorkflowCredentialBinding | null): boolean =>
  left === null
    ? right === null
    : right !== null && left.appId === right.appId && left.resourceType === right.resourceType && left.resourceId === right.resourceId;

const expired = (value: string | null | undefined, now: Date): boolean => Boolean(value && Date.parse(value) <= now.getTime());

export type WorkflowAuthorizationRevalidation =
  | {
      ok: true;
      subject: AccessSubject;
      permissionCap: PermissionLevel;
      credential: GridsWorkflowCredential | null;
    }
  | { ok: false; reason: string };

export type WorkflowAuthorizationDeps = {
  findCredential(id: string, serviceAccountId: string): Promise<ServiceAccountCredentialOverview | null>;
  getServiceAccount(id: string): Promise<ServiceAccount | null>;
  getUser(id: string): Promise<User | null>;
  now(): Date;
};

const findCredential = (id: string, _serviceAccountId: string): Promise<ServiceAccountCredentialOverview | null> =>
  serviceAccountCredentials.getOverview({ id });

const defaultDeps: WorkflowAuthorizationDeps = {
  findCredential,
  getServiceAccount: (id) => serviceAccounts.get({ id }),
  getUser: (id) => accounts.users.get({ id }),
  now: () => new Date(),
};

const subjectFor = (principal: GridsWorkflowPrincipal, actorServiceAccountId: string | null): AccessSubject | null => {
  if (principal.userId && !principal.serviceAccountId) {
    return {
      type: "user",
      userId: principal.userId,
      ...(actorServiceAccountId ? { delegatedByServiceAccountId: actorServiceAccountId } : {}),
    };
  }
  if (!principal.userId && principal.serviceAccountId) {
    return { type: "service_account", serviceAccountId: principal.serviceAccountId };
  }
  return null;
};

export const revalidateWorkflowPrincipal = async (
  principal: GridsWorkflowPrincipal,
  baseId: string,
  deps: WorkflowAuthorizationDeps = defaultDeps,
): Promise<WorkflowAuthorizationRevalidation> => {
  const actorServiceAccountId = principal.actorServiceAccountId ?? null;
  const acceptedCredential = principal.credential ?? null;
  const subject = subjectFor(principal, actorServiceAccountId);
  if (!subject) return { ok: false, reason: "Workflow principal is invalid." };

  const now = deps.now();
  if (subject.type === "user") {
    const user = await deps.getUser(subject.userId);
    if (!user || expired(user.accountExpires, now)) return { ok: false, reason: "Workflow user is inactive." };
  }

  if (!actorServiceAccountId && !acceptedCredential) {
    if (subject.type !== "user") return { ok: false, reason: "Service-account workflows require credential provenance." };
    return { ok: true, subject, permissionCap: "admin", credential: null };
  }
  if (!actorServiceAccountId || !acceptedCredential) {
    return { ok: false, reason: "Workflow credential provenance is incomplete." };
  }

  const serviceAccount = await deps.getServiceAccount(actorServiceAccountId);
  if (!serviceAccount || serviceAccount.status !== "active") {
    return { ok: false, reason: "Workflow service account is inactive." };
  }
  if (
    (serviceAccount.kind === "user_delegated" && (subject.type !== "user" || serviceAccount.delegatedUserId !== subject.userId)) ||
    (serviceAccount.kind === "resource_bound" && (subject.type !== "service_account" || serviceAccount.id !== subject.serviceAccountId))
  ) {
    return { ok: false, reason: "Workflow service-account subject changed." };
  }

  const currentBinding = workflowCredentialBinding(serviceAccount);
  if (!sameBinding(acceptedCredential.resourceBinding, currentBinding)) {
    return { ok: false, reason: "Workflow credential resource binding changed." };
  }
  if (
    currentBinding &&
    (currentBinding.appId !== "grids" || currentBinding.resourceType !== "base" || currentBinding.resourceId !== baseId)
  ) {
    return { ok: false, reason: "Workflow credential is not bound to this Grids base." };
  }

  if (expired(acceptedCredential.expiresAt, now)) return { ok: false, reason: "Workflow credential expired." };

  if (acceptedCredential.kind === "oauth") {
    if (acceptedCredential.id !== null || !acceptedCredential.expiresAt) {
      return { ok: false, reason: "Workflow OAuth credential provenance is invalid." };
    }
    return {
      ok: true,
      subject,
      permissionCap: minPermission(acceptedCredential.permissionCap, workflowPermissionFromScopes(acceptedCredential.scopes)),
      credential: acceptedCredential,
    };
  }

  if (!acceptedCredential.id) return { ok: false, reason: "Workflow API credential id is missing." };
  const current = await deps.findCredential(acceptedCredential.id, actorServiceAccountId);
  if (
    !current ||
    current.status !== "active" ||
    current.serviceAccount.id !== actorServiceAccountId ||
    current.serviceAccount.status !== "active"
  ) {
    return { ok: false, reason: "Workflow API credential is revoked or inactive." };
  }
  if (expired(current.expiresAt, now)) return { ok: false, reason: "Workflow API credential expired." };
  const currentCredential: GridsWorkflowCredential = {
    kind: "api_token",
    id: current.id,
    scopes: current.scopes,
    permissionCap: minPermission(acceptedCredential.permissionCap, workflowPermissionFromScopes(current.scopes)),
    expiresAt: current.expiresAt,
    resourceBinding: currentBinding,
  };
  return { ok: true, subject, permissionCap: currentCredential.permissionCap, credential: currentCredential };
};

export const authorizeWorkflowTarget = async (
  principal: GridsWorkflowPrincipal,
  target: ResolveTarget,
  required: PermissionLevel,
): Promise<boolean> => {
  const revalidated = await revalidateWorkflowPrincipal(principal, target.baseId);
  if (!revalidated.ok || !workflowPermissionAllows(revalidated.permissionCap, required)) return false;
  const grants = await loadGrantsForSubject({
    subject: revalidated.subject,
    baseId: target.baseId,
    tableId: "tableId" in target ? target.tableId : null,
    viewId: "viewId" in target ? target.viewId : null,
    formId: "formId" in target ? target.formId : null,
    documentTemplateId: "documentTemplateId" in target ? target.documentTemplateId : null,
    dashboardId: "dashboardId" in target ? target.dashboardId : null,
    workflowId: "workflowId" in target ? target.workflowId : null,
  });
  return hasAtLeast(resolveEffectivePermission(grants, target), required);
};
