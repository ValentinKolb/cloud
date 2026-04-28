import * as model from "./model";
import * as authz from "./authz";
import * as users from "./users";
import * as groups from "./groups";
import * as entities from "./entities";
import * as localGroups from "./local-groups";
import * as switching from "./switching";
import * as lifecycle from "./lifecycle";
import { accountsAppService } from "./app";

export { model, authz, users, groups, entities, localGroups, switching, lifecycle };
export { accountsAppService };

export const accounts = { model, authz, users, groups, entities, localGroups, switching, lifecycle, app: accountsAppService } as const;
