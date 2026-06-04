// fallow-ignore-file unused-file
import { describe, expect, test } from "bun:test";
import { ShiftTemplateInputSchema } from "./contracts";

describe("ShiftTemplateInputSchema", () => {
  test("accepts an optional max people value above the target", () => {
    expect(
      ShiftTemplateInputSchema.safeParse({
        weekday: 1,
        title: "Morning shift",
        startTime: "09:00",
        endTime: "13:00",
        minPeople: 2,
        maxPeople: 4,
        active: true,
      }).success,
    ).toBe(true);
  });

  test("rejects max people below the target", () => {
    const result = ShiftTemplateInputSchema.safeParse({
      weekday: 1,
      title: "Morning shift",
      startTime: "09:00",
      endTime: "13:00",
      minPeople: 4,
      maxPeople: 2,
      active: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("Maximum people must be greater than or equal to required people");
  });
});
