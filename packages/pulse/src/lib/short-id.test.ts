import { describe, expect, test } from "bun:test";
import { SHORT_ID_REGEX, withShortId } from "./short-id";

describe("Pulse short IDs", () => {
  test("allocates exact readable IDs and retries Bun unique violations", async () => {
    let attempts = 0;
    const value = await withShortId("source", async (shortId) => {
      expect(SHORT_ID_REGEX.test(shortId)).toBe(true);
      attempts += 1;
      if (attempts === 1) throw { errno: "23505", constraint: "idx_pulse_sources_short_id" };
      return shortId;
    });

    expect(value).toHaveLength(6);
    expect(attempts).toBe(2);
  });

  test("does not retry unrelated failures", async () => {
    const error = new Error("write failed");
    await expect(withShortId("base", async () => Promise.reject(error))).rejects.toBe(error);
  });
});
