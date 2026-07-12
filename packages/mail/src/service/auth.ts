import type { AccessSubject, PermissionLevel, RequestActor } from "@valentinkolb/cloud/server";
import { MAIL_APP_ID, MAILBOX_RESOURCE_TYPE } from "../config";
import type { ActorRef } from "../contracts";

export type MailRequestContext = {
  actor: RequestActor;
  accessSubject: AccessSubject;
  requestId?: string | null;
};

const PERMISSION_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

const minPermission = (left: PermissionLevel, right: PermissionLevel): PermissionLevel =>
  PERMISSION_RANK[left] <= PERMISSION_RANK[right] ? left : right;

export const permissionFromScopes = (scopes: readonly string[]): PermissionLevel => {
  if (scopes.includes("admin") || scopes.includes("mail:admin") || scopes.includes("mail:*")) return "admin";
  if (scopes.includes("write") || scopes.includes("mail:write")) return "write";
  if (scopes.includes("read") || scopes.includes("mail:read")) return "read";
  return "none";
};

export const userBackedActor = (context: MailRequestContext) =>
  context.actor.kind === "user" ? context.actor.user : context.actor.delegatedUser;

export const isPlatformAdmin = (context: MailRequestContext): boolean => userBackedActor(context)?.roles.includes("admin") ?? false;

export const isResourceBoundToMailbox = (context: MailRequestContext, mailboxId: string): boolean => {
  if (context.actor.kind !== "service_account" || context.actor.serviceAccount.kind !== "resource_bound") return true;
  return (
    context.actor.serviceAccount.appId === MAIL_APP_ID &&
    context.actor.serviceAccount.resourceType === MAILBOX_RESOURCE_TYPE &&
    context.actor.serviceAccount.resourceId === mailboxId
  );
};

export const capByCredentialScopes = (context: MailRequestContext, permission: PermissionLevel): PermissionLevel => {
  if (context.actor.kind !== "service_account") return permission;
  return minPermission(permission, permissionFromScopes(context.actor.scopes));
};

export const actorRefFromRequest = (context: MailRequestContext): ActorRef => {
  if (context.actor.kind === "user") return { kind: "user", userId: context.actor.user.id };
  return {
    kind: "service_account",
    serviceAccountId: context.actor.serviceAccount.id,
    delegatedUserId: context.actor.delegatedUser?.id ?? null,
  };
};

export const auditActorFromRequest = (context: MailRequestContext) => {
  const user = userBackedActor(context);
  return {
    userId: user?.id ?? null,
    uid: user?.uid ?? null,
    provider: user?.provider ?? null,
    roles: user?.roles ?? [],
  };
};
