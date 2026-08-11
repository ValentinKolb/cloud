import { describe, expect, test } from "bun:test";
import { newShortId, SHORT_ID_REGEX, withShortIdRetry } from "./short-id";

describe("Contacts short IDs", () => {
  test("generates compact readable identifiers", () => {
    const ids = Array.from({ length: 100 }, newShortId);
    expect(ids.every((id) => SHORT_ID_REGEX.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("retries only the matching unique constraint", async () => {
    let attempts = 0;
    const value = await withShortIdRetry(["contact"], async () => {
      attempts++;
      if (attempts === 1) throw { errno: "23505", constraint: "idx_contacts_contacts_short_id" };
      return "created";
    });
    expect(value).toBe("created");
    expect(attempts).toBe(2);

    await expect(
      withShortIdRetry(["contact"], async () => {
        throw { errno: "23505", constraint: "contacts_pkey" };
      }),
    ).rejects.toEqual({ errno: "23505", constraint: "contacts_pkey" });
  });
});
