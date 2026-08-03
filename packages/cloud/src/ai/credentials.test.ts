import { describe, expect, spyOn, test } from "bun:test";
import type { sql } from "bun";
import { getAiCredential, pruneAiCredentials, splitAiProfileCredentials } from "./credentials";

const recordingSql = () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve([]);
  }) as unknown as typeof sql;
  return { calls, db };
};

const profile = (extra: Record<string, unknown> = {}) => ({
  id: "openrouter-fast",
  label: "OpenRouter Fast",
  provider: "openrouter",
  model: "openai/gpt-4.1-mini",
  enabled: true,
  ...extra,
});

describe("splitAiProfileCredentials", () => {
  test("takes a typed key out of the profile and reports it separately", () => {
    const split = splitAiProfileCredentials(JSON.stringify([profile({ apiKey: "sk-live-1" })]));

    expect(split?.credentials).toEqual([{ profileId: "openrouter-fast", secret: "sk-live-1" }]);
    // The whole point: what gets stored carries no secret.
    expect(split?.profilesJson).not.toContain("sk-live-1");
    expect(split?.profilesJson).not.toContain("apiKey");
  });

  test("an untouched key field is not a deletion", () => {
    // The form sends no apiKey when the admin did not type one. Reporting an
    // empty credential here would overwrite the stored key with nothing.
    const split = splitAiProfileCredentials(JSON.stringify([profile(), profile({ id: "b", apiKey: "   " })]));

    expect(split?.credentials).toEqual([]);
    expect(split?.profileIds).toEqual(["openrouter-fast", "b"]);
  });

  test("drops the legacy credentialSetting pointer", () => {
    const split = splitAiProfileCredentials(JSON.stringify([profile({ credentialSetting: "ai.openrouter_api_key" })]));

    expect(split?.profilesJson).not.toContain("credentialSetting");
  });

  test("reports every profile id so pruning keeps the surviving ones", () => {
    const split = splitAiProfileCredentials(JSON.stringify([profile(), profile({ id: "second" })]));

    expect(split?.profileIds).toEqual(["openrouter-fast", "second"]);
  });

  test("uses the canonical trimmed profile id for both the profile and its credential", () => {
    const split = splitAiProfileCredentials(JSON.stringify([profile({ id: "  openrouter-fast  ", apiKey: " secret " })]));

    expect(split?.profileIds).toEqual(["openrouter-fast"]);
    expect(split?.credentials).toEqual([{ profileId: "openrouter-fast", secret: "secret" }]);
    expect(JSON.parse(split?.profilesJson ?? "[]")[0]?.id).toBe("openrouter-fast");
  });

  test("hands malformed input back rather than rewriting the admin's error", () => {
    expect(splitAiProfileCredentials("{ not json")).toBeNull();
    expect(splitAiProfileCredentials(JSON.stringify({ notAnArray: true }))).toBeNull();
    expect(splitAiProfileCredentials(null)).toBeNull();
    expect(splitAiProfileCredentials([])).toBeNull();
  });

  test("tolerates an empty value", () => {
    const split = splitAiProfileCredentials("");

    expect(split?.credentials).toEqual([]);
    expect(split?.profileIds).toEqual([]);
  });
});

describe("pruneAiCredentials", () => {
  test("uses the provided transaction client and a valid Postgres text array literal", async () => {
    const { calls, db } = recordingSql();

    await pruneAiCredentials(["qwen3.6", "cortecs-glm-5.2"], db);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("profile_id <> ALL(?::text[])");
    expect(calls[0]?.values).toEqual(['{"qwen3.6","cortecs-glm-5.2"}']);
  });
});

describe("getAiCredential", () => {
  test("treats an unreadable encrypted value as a missing credential", async () => {
    const db = (() => Promise.resolve([{ secret: "not-an-encrypted-value" }])) as unknown as typeof sql;
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      expect(await getAiCredential("broken", db)).toBeNull();
    } finally {
      warning.mockRestore();
    }
  });

  test("does not disguise database failures as missing credentials", async () => {
    const db = (() => Promise.reject(new Error("database unavailable"))) as unknown as typeof sql;

    await expect(getAiCredential("model", db)).rejects.toThrow("database unavailable");
  });
});
