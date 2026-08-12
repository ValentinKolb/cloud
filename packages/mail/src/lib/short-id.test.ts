import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { newShortId, SHORT_ID_REGEX, withShortIdDb, withShortIdRetry } from "./short-id";

describe("Mail short IDs", () => {
  test("generates compact readable identifiers", () => {
    const ids = Array.from({ length: 100 }, newShortId);
    expect(ids.every((id) => SHORT_ID_REGEX.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("retries only the matching short-ID unique constraint", async () => {
    let attempts = 0;
    const value = await withShortIdRetry(["message"], async () => {
      attempts++;
      if (attempts === 1) throw { code: "23505", constraint_name: "message_contents_short_id_idx" };
      return "created";
    });

    expect(value).toBe("created");
    expect(attempts).toBe(2);
    await expect(
      withShortIdRetry(["message"], async () => {
        throw { code: "23505", constraint: "message_contents_pkey" };
      }),
    ).rejects.toEqual({ code: "23505", constraint: "message_contents_pkey" });
  });

  test("isolates transaction retries in savepoints", async () => {
    let attempts = 0;
    const savepoint = async <T>(write: (db: SQL) => Promise<T>): Promise<T> => {
      attempts++;
      if (attempts === 1) throw { code: "23505", constraint: "drafts_short_id_idx" };
      return write({} as SQL);
    };

    const transaction = { savepoint } as unknown as SQL;
    const value = await withShortIdDb(transaction, "draft", async () => "created");
    expect(value).toBe("created");
    expect(attempts).toBe(2);
  });
});
