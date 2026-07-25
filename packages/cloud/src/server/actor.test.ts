import { describe, expect, test } from "bun:test";
import { isDirectUserActor, userFromActor } from "./actor";

// Only the fields the helpers read; the real shapes carry far more.
const user = { id: "u-1", uid: "alice" } as never;
const other = { id: "u-2", uid: "bob" } as never;

const session = { kind: "user", user } as never;
const personalKey = { kind: "service_account", delegatedUser: user, scopes: [] } as never;
const resourceKey = { kind: "service_account", delegatedUser: null, scopes: ["read"] } as never;

describe("userFromActor", () => {
  test("a session acts as itself", () => {
    expect(userFromActor(session)).toBe(user);
  });

  test("a user-delegated credential acts as its user", () => {
    expect(userFromActor(personalKey)).toBe(user);
    expect(userFromActor(personalKey)).not.toBe(other);
  });

  test("a resource-bound credential has no user", () => {
    expect(userFromActor(resourceKey)).toBeNull();
    expect(userFromActor(undefined)).toBeNull();
  });
});

describe("isDirectUserActor", () => {
  test("only a session counts as the user themselves", () => {
    expect(isDirectUserActor(session)).toBe(true);
  });

  test("a personal API key does not, even though it acts as that user", () => {
    // This is the whole point: it passes userFromActor, so an authentication
    // endpoint gated only on that would let a leaked key enrol a passkey.
    expect(userFromActor(personalKey)).toBe(user);
    expect(isDirectUserActor(personalKey)).toBe(false);
  });

  test("a resource-bound credential and an unauthenticated request do not", () => {
    expect(isDirectUserActor(resourceKey)).toBe(false);
    expect(isDirectUserActor(undefined)).toBe(false);
  });
});
