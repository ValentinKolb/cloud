import { gridsService } from "../../../service";
import type { AuthUser } from "./workspace-state-model";

const resolveLevel = async (
  user: AuthUser,
  scope: { baseId: string; tableId?: string; viewId?: string; workflowId?: string; documentTemplateId?: string },
) => {
  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    ...scope,
  });
  return gridsService.permission.resolve(grants, scope);
};

export const resolveBaseLevel = (user: AuthUser, baseId: string) => resolveLevel(user, { baseId });

export const workflowLevelForUser = (user: AuthUser, baseId: string, workflowId: string) => resolveLevel(user, { baseId, workflowId });

export const viewLevelForUser = (user: AuthUser, baseId: string, tableId: string, viewId: string) =>
  resolveLevel(user, { baseId, tableId, viewId });

export const documentTemplateLevelForUser = (user: AuthUser, baseId: string, tableId: string, documentTemplateId: string) =>
  resolveLevel(user, { baseId, tableId, documentTemplateId });
