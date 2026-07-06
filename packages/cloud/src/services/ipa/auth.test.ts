import { describe, expect, test } from "bun:test";
import { __ipaAuthTest } from "./auth";

describe("FreeIPA password change failure mapping", () => {
  test("returns policy messages instead of current-password fallback", () => {
    const result = __ipaAuthTest.mapPasswordChangeFailure({
      status: 400,
      pwchangeResult: "policy-error",
      policyError: null,
      body: "policy-error: Password must contain at least one special character",
    });

    expect(result).toEqual({
      ok: false,
      error: "Password must contain at least one special character",
      status: 400,
    });
  });

  test("does not treat password-history policy text as a current-password failure", () => {
    const result = __ipaAuthTest.mapPasswordChangeFailure({
      status: 400,
      pwchangeResult: "policy-error",
      policyError: null,
      body: "policy-error: New password is in list of old passwords",
    });

    expect(result).toEqual({
      ok: false,
      error: "New password is in list of old passwords",
      status: 400,
    });
  });

  test("reads policy messages from the FreeIPA policy header", () => {
    const result = __ipaAuthTest.mapPasswordChangeFailure({
      status: 400,
      pwchangeResult: "policy-error",
      policyError: "Password is too short",
      body: "",
    });

    expect(result).toEqual({
      ok: false,
      error: "Password is too short",
      status: 400,
    });
  });

  test("keeps current-password errors separate", () => {
    const result = __ipaAuthTest.mapPasswordChangeFailure({
      status: 400,
      pwchangeResult: "invalid-password",
      policyError: null,
      body: "Current password is incorrect",
    });

    expect(result).toEqual({
      ok: false,
      error: "Current password is incorrect.",
      status: 401,
    });
  });

  test("uses a new-password rejection for unknown FreeIPA failures", () => {
    const result = __ipaAuthTest.mapPasswordChangeFailure({
      status: 400,
      pwchangeResult: "invalid-password",
      policyError: null,
      body: "",
    });

    expect(result).toEqual({
      ok: false,
      error: "FreeIPA rejected the new password. Choose a different password and try again.",
      status: 400,
    });
  });
});
