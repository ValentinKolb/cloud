import { hasPermission, type PermissionLevel } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { getTemplatePermission, getWorkspacePermission } from "./access";
import type { InvoiceActor } from "./types";

export const requireInvoiceUser = (actor: InvoiceActor): Result<string> => {
  if (!actor.userId) return fail(err.forbidden("Authenticated invoice user required"));
  return ok(actor.userId);
};

export const requireWorkspacePermission = async (config: {
  workspaceId: string;
  actor: InvoiceActor;
  requiredLevel: PermissionLevel;
}): Promise<Result<PermissionLevel>> => {
  const permission = await getWorkspacePermission({
    workspaceId: config.workspaceId,
    userId: config.actor.userId,
    userGroups: config.actor.userGroups,
  });

  if (!hasPermission(permission, config.requiredLevel)) {
    return fail(err.forbidden("Access denied"));
  }

  return ok(permission);
};

export const requireTemplatePermission = async (config: {
  workspaceId: string;
  templateId: string;
  actor: InvoiceActor;
  requiredLevel: PermissionLevel;
}): Promise<Result<PermissionLevel>> => {
  const permission = await getTemplatePermission({
    workspaceId: config.workspaceId,
    templateId: config.templateId,
    userId: config.actor.userId,
    userGroups: config.actor.userGroups,
  });

  if (!hasPermission(permission, config.requiredLevel)) {
    return fail(err.forbidden("Access denied"));
  }

  return ok(permission);
};
