import { usersService } from "./users";
import { groupsService } from "./groups";
import { accountRequestsService } from "./account-requests";

/**
 * Accounts app service facade.
 * Keeps domain logic grouped by `user`, `group`, and `accountRequest`.
 */
export const accountsService = {
  user: usersService,
  group: groupsService,
  accountRequest: accountRequestsService,
};

export { usersService, groupsService, accountRequestsService };
export type { UsersService } from "./users";
export type { GroupsService } from "./groups";
export type {
  AccountRequestsService,
  AccountRequest,
  AccountRequestStatus,
} from "./account-requests";
