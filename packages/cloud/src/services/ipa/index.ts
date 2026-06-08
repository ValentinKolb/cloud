import { providers } from "../providers";
import { search } from "./search";
import { getServiceIpaSession } from "./service-account";

export const ipa = {
  auth: providers.ipa.auth,
  getServiceIpaSession,
  users: {
    ...providers.ipa.users,
    addIpa: providers.ipa.users.create,
    delete: providers.ipa.users.remove,
  },
  groups: {
    ...providers.ipa.groups,
    delete: providers.ipa.groups.remove,
  },
  search,
  sync: providers.ipa.sync,
};
