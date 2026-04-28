import * as ipaAuth from "../ipa/auth";
import * as ipaUsers from "../ipa/users";
import * as ipaGroups from "../ipa/groups";
import * as ipaSync from "../ipa/sync";
import { local } from "./local";

export const ipa = {
  auth: ipaAuth,
  users: {
    ...ipaUsers,
    create: ipaUsers.addIpa,
    update: ipaUsers.updateProfile,
    remove: ipaUsers.deleteUser,
  },
  groups: {
    ...ipaGroups,
    remove: ipaGroups.del,
  },
  sync: {
    ...ipaSync,
    run: ipaSync.syncFromIpa,
    user: ipaSync.syncUser,
  },
} as const;

export { local };
export const providers = { ipa, local } as const;
