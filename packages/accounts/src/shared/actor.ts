import type { AuthContext } from "@valentinkolb/cloud/server";
import { expectUserBackedActor, getUserBackedActor } from "@valentinkolb/cloud/server";

type UserBackedActor = AuthContext["Variables"]["user"];

export { expectUserBackedActor, getUserBackedActor };

/** Accounts' audit/service layer takes a flattened actor descriptor. */
export const toAccountsActor = (actor: UserBackedActor) => ({
  userId: actor.id,
  uid: actor.uid,
  roles: actor.roles,
  provider: actor.provider,
});
