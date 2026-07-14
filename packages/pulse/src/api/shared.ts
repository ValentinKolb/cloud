import type { User } from "@valentinkolb/cloud/contracts";
import { err, fail, ok, type AuthContext, type Result } from "@valentinkolb/cloud/server";
import type { Context } from "hono";
import type { AccessScope } from "../service/access-control";

export const requireParam = (value: string | undefined, label: string) =>
  value ? { ok: true as const, value } : { ok: false as const, result: fail(err.badInput(`Missing ${label}`)) };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const requireUuidParam = (value: string | undefined, label: string) => {
  const param = requireParam(value, label);
  if (!param.ok) return param;
  return UUID_RE.test(param.value)
    ? param
    : { ok: false as const, result: fail(err.badInput(`${label} must be a UUID`)) };
};

export const requireUserBackedActor = (c: Context<AuthContext>): Result<User> => {
  const actor = c.get("actor");
  const user = actor.kind === "user" ? actor.user : actor.delegatedUser;
  return user ? ok(user) : fail(err.forbidden("This endpoint requires a user-backed actor"));
};

export const requestAccessScope = (c: Context<AuthContext>): AccessScope => {
  const subject = c.get("accessSubject");
  if (subject.type === "user") return { id: subject.userId };

  const actor = c.get("actor");
  if (actor.kind !== "service_account" || actor.delegatedUser) {
    throw new Error("Resource access subject does not match the authenticated actor");
  }
  return {
    subject,
    serviceAccount: actor.serviceAccount,
    scopes: actor.scopes,
  };
};
