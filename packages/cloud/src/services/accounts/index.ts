import { accountsAppService } from "./app";
import * as authz from "./authz";
import * as entities from "./entities";
import * as groups from "./groups";
import * as lifecycle from "./lifecycle";
import * as localGroups from "./local-groups";
import * as model from "./model";
import * as switching from "./switching";
import * as users from "./users";

export type { AccountNotificationDeliveryResult, AccountsNotificationSender } from "./notification-sender";
export { accountsAppService, authz, entities, groups, lifecycle, localGroups, model, switching, users };

export const accounts = { model, authz, users, groups, entities, localGroups, switching, lifecycle, app: accountsAppService } as const;
