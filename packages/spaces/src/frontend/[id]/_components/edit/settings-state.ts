import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { User } from "@/contracts";
import { spacesService } from "@/service";
import type { SpaceSettingsContext, SpaceUserSettings } from "@/settings-context";

export const loadSpaceSettingsContext = async (params: {
  user: Pick<User, "id">;
  spaceId: string;
  settings: SpaceUserSettings;
}): Promise<Result<SpaceSettingsContext>> => {
  const [space, permission] = await Promise.all([
    spacesService.space.get({ id: params.spaceId }),
    spacesService.space.permission.get({
      spaceId: params.spaceId,
      subject: { type: "user", userId: params.user.id },
    }),
  ]);

  if (!space) return fail(err.notFound("Space"));
  if (permission === "none") return fail(err.forbidden("Access denied"));

  const detail = await spacesService.space.getDetail({ id: params.spaceId });
  if (!detail) return fail(err.notFound("Space"));

  if (permission !== "admin") {
    return ok({
      space: detail,
      settings: params.settings,
      permission,
      accessEntries: [],
      apiKeys: [],
      wormholes: [],
    });
  }

  const actor = spacesService.wormhole.actorForUser(params.user);
  const [access, apiKeys, wormholes] = await Promise.all([
    spacesService.access.list({ spaceId: params.spaceId }),
    spacesService.access.apiKeys.list({ spaceId: params.spaceId }),
    spacesService.wormhole.listConfigured({ sourceSpaceId: params.spaceId, actor }),
  ]);
  if (!wormholes.ok) {
    return fail(wormholes.status === 403 ? err.forbidden(wormholes.error) : err.internal(wormholes.error));
  }

  return ok({
    space: detail,
    settings: params.settings,
    permission,
    accessEntries: access.items,
    apiKeys,
    wormholes: wormholes.data,
  });
};
