import { describe, expect, test } from "bun:test";
import { projectMailCapabilityError } from "./mail-integration";

describe("Spaces Mail capability integration errors", () => {
  test("preserves an unknown action outcome without retrying or relabeling it", () => {
    expect(projectMailCapabilityError({ code: "ACTION_OUTCOME_UNKNOWN", message: "Outcome unknown", status: 502 })).toEqual({
      ok: false,
      code: "ACTION_OUTCOME_UNKNOWN",
      message: "Outcome unknown",
      status: 502,
    });
  });

  test("normalizes unavailable discovery status while preserving its exact code", () => {
    expect(projectMailCapabilityError({ code: "APP_UNAVAILABLE", message: "Unavailable", status: 404 })).toEqual({
      ok: false,
      code: "APP_UNAVAILABLE",
      message: "Unavailable",
      status: 503,
    });
  });
});
