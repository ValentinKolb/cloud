import type { AuthContext } from "@valentinkolb/cloud/server";
import type { Context } from "hono";

type UserBackedActor = AuthContext["Variables"]["user"];

export const getUserBackedActor = <T extends AuthContext>(c: Context<T>): UserBackedActor | null => {
  const actor = c.get("actor") as AuthContext["Variables"]["actor"] | undefined;
  if (!actor) return null;
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

export const expectUserBackedActor = <T extends AuthContext>(c: Context<T>): UserBackedActor => {
  const user = getUserBackedActor(c);
  if (!user) throw new Error("Expected user-backed actor after role middleware");
  return user;
};

export const toAccountsActor = (actor: UserBackedActor) => ({
  userId: actor.id,
  uid: actor.uid,
  roles: actor.roles,
  provider: actor.provider,
});
