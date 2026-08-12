import { expect, test } from "bun:test";
import { newShortId, SHORT_ID_REGEX, withShortIdRetry } from "./short-id";

test("creates six-character readable Venue IDs", () => {
  expect(newShortId()).toMatch(SHORT_ID_REGEX);
});

test("retries only the matching Bun unique-constraint error", async () => {
  let attempts = 0;
  const result = await withShortIdRetry(["venue"], async () => {
    attempts += 1;
    if (attempts === 1) throw { errno: "23505", constraint: "idx_venue_venues_short_id" };
    return "created";
  });
  expect(result).toBe("created");
  expect(attempts).toBe(2);
});

test("does not retry unrelated unique violations", async () => {
  const error = { errno: "23505", constraint: "venue_venues_slug_key" };
  expect(withShortIdRetry(["venue"], async () => Promise.reject(error))).rejects.toBe(error);
});
