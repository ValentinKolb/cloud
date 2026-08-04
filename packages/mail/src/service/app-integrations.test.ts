import { describe, expect, test } from "bun:test";
import { projectAppCapabilityError } from "./app-integrations";

describe("Mail app capability integration errors", () => {
  test("preserves an unknown action outcome without retrying or relabeling it", () => {
    expect(projectAppCapabilityError({ code: "ACTION_OUTCOME_UNKNOWN", message: "Outcome unknown", status: 502 })).toEqual({
      ok: false,
      code: "ACTION_OUTCOME_UNKNOWN",
      message: "Outcome unknown",
      status: 502,
    });
  });

  test("normalizes unavailable discovery status while preserving its exact code", () => {
    expect(projectAppCapabilityError({ code: "CAPABILITY_NOT_FOUND", message: "Missing", status: 404 })).toEqual({
      ok: false,
      code: "CAPABILITY_NOT_FOUND",
      message: "Missing",
      status: 503,
    });
  });
});
