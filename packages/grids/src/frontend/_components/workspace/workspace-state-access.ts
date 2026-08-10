import { gridsService } from "../../../service";
import { ALL_RECORD_ACCESS, type AuthorizedRecordAccess } from "../../../service/record-access";
import type { AuthUser } from "./workspace-state-model";

const resolveLevel = async (user: AuthUser, baseId: string) => {
  const grants = await gridsService.permission.loadBaseGrantsForSubject({ baseId, subject: { type: "user", userId: user.id } });
  return gridsService.permission.resolve(grants, { baseId });
};

export const resolveBaseLevel = (user: AuthUser, baseId: string) => resolveLevel(user, baseId);

export const recordAccessForUser = async (user: AuthUser, baseId: string): Promise<AuthorizedRecordAccess | null> => {
  const level = await resolveLevel(user, baseId);
  return gridsService.permission.hasAtLeast(level, "read") ? ALL_RECORD_ACCESS : null;
};
