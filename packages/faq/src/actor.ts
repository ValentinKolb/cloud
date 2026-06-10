import type { AuthContext } from "@valentinkolb/cloud/server";
import type { Context } from "hono";

type UserBackedActor = AuthContext["Variables"]["user"];

export const getUserBackedActor = <T extends AuthContext>(c: Context<T>): UserBackedActor | null => {
  const actor = c.get("actor") as AuthContext["Variables"]["actor"] | undefined;
  if (!actor) return null;
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};
