import { describe, expect, test } from "bun:test";
import { IdFieldConfigSchema } from "../field-types/system";
import { generateIdValue, generatedIdRequiresRetry, isGeneratedIdUniqueCollision } from "./generated-ids";
import { fieldUniqueIndexName } from "./field-indexes";
import type { Field } from "./types";

const field = (config: Record<string, unknown>): Field => ({
  id: "019f0c1a-90f8-7000-a2f3-768748d8c0f0",
  shortId: "id123",
  tableId: "table",
  name: "Inventory ID",
  description: null,
  type: "id",
  config,
  position: 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: true,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const fakeSequenceClient = (next: number) =>
  ({
    unsafe: async (statement: string) => (statement.startsWith("SELECT nextval") ? [{ next }] : []),
  }) as any;

const uniqueViolation = (constraintName: string) => {
  const e = new Error("duplicate key value violates unique constraint") as Error & {
    code: string;
    constraint_name: string;
  };
  e.code = "23505";
  e.constraint_name = constraintName;
  return e;
};

describe("generated ID field config", () => {
  test("normalizes empty config to sequence", () => {
    expect(IdFieldConfigSchema.parse({})).toEqual({ strategy: "sequence" });
  });

  test("rejects invalid strategy-specific values", () => {
    expect(IdFieldConfigSchema.safeParse({ strategy: "short_code", length: 2 }).success).toBe(false);
    expect(IdFieldConfigSchema.safeParse({ strategy: "random_code", groups: 8 }).success).toBe(false);
    expect(IdFieldConfigSchema.safeParse({ strategy: "date_sequence", period: "week" }).success).toBe(false);
  });
});

describe("generateIdValue", () => {
  test("generates padded sequence IDs with prefix", async () => {
    await expect(
      generateIdValue(field({ strategy: "sequence", prefix: "INV-", padding: 5 }), { client: fakeSequenceClient(42) }),
    ).resolves.toBe("INV-00042");
  });

  test("generates date sequence IDs scoped to the configured period", async () => {
    await expect(
      generateIdValue(field({ strategy: "date_sequence", prefix: "LOAN-", period: "month", padding: 3 }), {
        client: fakeSequenceClient(7),
        now: new Date("2026-06-07T21:30:00.000Z"),
        dateConfig: { timeZone: "Europe/Berlin" },
      }),
    ).resolves.toBe("LOAN-202606-007");
  });

  test("generates prefixed short and random codes", async () => {
    const short = await generateIdValue(field({ strategy: "short_code", prefix: "KIT-", length: 6 }));
    expect(short).toMatch(/^KIT-[A-Za-z0-9]{6}$/);

    const random = await generateIdValue(field({ strategy: "random_code", prefix: "EXT-", groups: 2, segmentLength: 4 }));
    expect(random).toMatch(/^EXT-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  });

  test("generates UUID and UUIDv7 values with optional prefix", async () => {
    const uuid = await generateIdValue(field({ strategy: "uuid", prefix: "U-" }));
    expect(uuid).toMatch(/^U-[0-9a-f-]{36}$/i);

    const uuidv7 = await generateIdValue(field({ strategy: "uuidv7", prefix: "V7-" }));
    expect(uuidv7).toMatch(/^V7-[0-9a-f-]{36}$/i);
  });

  test("generates prefixed ULID values", async () => {
    const ulid = await generateIdValue(field({ strategy: "ulid", prefix: "ULID-" }));
    expect(ulid).toMatch(/^ULID-[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe("generated ID collision handling", () => {
  test("retries only generated random ID unique-index collisions", () => {
    const short = field({ strategy: "short_code", length: 5 });
    expect(generatedIdRequiresRetry(short)).toBe(true);
    expect(generatedIdRequiresRetry(field({ strategy: "ulid" }))).toBe(true);
    expect(generatedIdRequiresRetry(field({ strategy: "sequence" }))).toBe(false);

    expect(isGeneratedIdUniqueCollision(uniqueViolation(fieldUniqueIndexName(short.id)), [short])).toBe(true);
    expect(isGeneratedIdUniqueCollision(uniqueViolation("some_other_unique_index"), [short])).toBe(false);
  });
});
