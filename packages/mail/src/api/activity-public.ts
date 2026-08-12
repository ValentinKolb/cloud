import { ok, type Result } from "@k2b/stdlib";
import { activityPublic } from "../service";

export const projectActivityResult = async <T extends activityPublic.PublicActivityItem>(
  result: Result<{ items: T[]; nextCursor: string | null }>,
): Promise<Result<{ items: T[]; nextCursor: string | null }>> =>
  result.ok ? ok({ ...result.data, items: await activityPublic.projectActivityItems(result.data.items) }) : result;
