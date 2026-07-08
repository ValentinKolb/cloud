import { describe, expect, test } from "bun:test";
import { lookupHandler, relationHandler, rollupHandler } from "./relations";

// =============================================================================
// Relation / lookup / rollup field-type handlers.
//
// relation is a link field and validates user-submitted target ids;
// lookup and rollup are computed field kinds with config validation only.
// =============================================================================

// Real UUIDv4-shaped values — Zod's `.uuid()` rejects degenerate
// 11111111-... strings because they don't carry a valid version /
// variant nibble. Fixed test fixtures keep failures stable.
const UUID_A = "8d2fc223-a7af-4e77-80e8-35008033479d";
const UUID_B = "0d3043c1-aeca-44c1-9554-8eb95c3dda8c";
const UUID_C = "f758872b-bc72-44ff-a285-5370727c6ef5";
const TARGET_TABLE = "7644cd04-e6c5-4b15-a86f-41f1c9f3598f";

const cfg = (overrides: Record<string, unknown> = {}) => ({
  targetTableId: TARGET_TABLE,
  cardinality: "multiple" as const,
  ...overrides,
});

describe("relationHandler.validate — config gating", () => {
  test("no targetTableId + null value → ok(null) when not required", () => {
    const r = relationHandler.validate(null, {}, false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  test("no targetTableId + null value → fail when required", () => {
    const r = relationHandler.validate(null, {}, true);
    expect(r.ok).toBe(false);
  });

  test("no targetTableId + a link supplied → fail (unconfigured target)", () => {
    const r = relationHandler.validate(UUID_A, {}, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no target table/i);
  });

  test("invalid configRaw is rejected before the value is even inspected", () => {
    const r = relationHandler.validate(UUID_A, { cardinality: "huge" }, false);
    expect(r.ok).toBe(false);
  });
});

describe("relationHandler.validate — uuid coercion", () => {
  test("a single uuid string is sugared into a 1-element array", () => {
    const r = relationHandler.validate(UUID_A, cfg(), false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([UUID_A]);
  });

  test("a non-uuid string is rejected", () => {
    const r = relationHandler.validate("not-a-uuid", cfg(), false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/uuid/i);
  });

  test("an array of valid uuids is accepted", () => {
    const r = relationHandler.validate([UUID_A, UUID_B], cfg(), false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([UUID_A, UUID_B]);
  });

  test("array entries that aren't strings are rejected", () => {
    const r = relationHandler.validate([UUID_A, 42], cfg(), false);
    expect(r.ok).toBe(false);
  });

  test("array entries that aren't valid uuids are rejected", () => {
    const r = relationHandler.validate([UUID_A, "garbage"], cfg(), false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/garbage/);
  });

  test("non-string non-array input is rejected", () => {
    const r = relationHandler.validate(42, cfg(), false);
    expect(r.ok).toBe(false);
  });
});

describe("relationHandler.validate — dedup + emptiness", () => {
  test("duplicate uuids are deduped while preserving first-seen order", () => {
    const r = relationHandler.validate([UUID_A, UUID_B, UUID_A, UUID_C, UUID_B], cfg(), false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([UUID_A, UUID_B, UUID_C]);
  });

  test("empty array → null when not required", () => {
    const r = relationHandler.validate([], cfg(), false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  test("empty array + required → fail", () => {
    const r = relationHandler.validate([], cfg(), true);
    expect(r.ok).toBe(false);
  });

  test("array of duplicates collapsing to required count works", () => {
    // Required + a single duplicate that dedupes to 1 element passes.
    const r = relationHandler.validate([UUID_A, UUID_A], cfg(), true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([UUID_A]);
  });
});

describe("relationHandler.validate — cardinality", () => {
  test("single + array of one is accepted", () => {
    const r = relationHandler.validate([UUID_A], cfg({ cardinality: "single" }), false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([UUID_A]);
  });

  test("single + array of two is rejected", () => {
    const r = relationHandler.validate([UUID_A, UUID_B], cfg({ cardinality: "single" }), false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at most one/i);
  });

  test("missing cardinality defaults to multiple (accepts many)", () => {
    const r = relationHandler.validate([UUID_A, UUID_B, UUID_C], { targetTableId: TARGET_TABLE }, false);
    expect(r.ok).toBe(true);
  });
});

describe("lookupHandler / rollupHandler — computed config only", () => {
  test("lookup configSchema accepts empty / partial config (UI lets users wire later)", () => {
    expect(lookupHandler.kind).toBe("computed");
    expect(lookupHandler.configSchema.safeParse({}).success).toBe(true);
    expect(lookupHandler.configSchema.safeParse({ relationFieldId: UUID_A }).success).toBe(true);
  });

  test("lookup configSchema preserves display format", () => {
    const format = { kind: "barcode", bcid: "qrcode" };
    const parsed = lookupHandler.configSchema.safeParse({
      relationFieldId: UUID_A,
      targetFieldId: UUID_B,
      format,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect((parsed.data as { format?: unknown }).format).toEqual(format);
  });

  test("rollup configSchema accepts empty / partial config", () => {
    expect(rollupHandler.kind).toBe("computed");
    expect(rollupHandler.configSchema.safeParse({}).success).toBe(true);
    expect(rollupHandler.configSchema.safeParse({ agg: "sum" }).success).toBe(true);
  });

  test("rollup configSchema preserves display format", () => {
    const format = { kind: "decimal", precision: 2, thousandsSeparator: true };
    const parsed = rollupHandler.configSchema.safeParse({
      relationFieldId: UUID_A,
      targetFieldId: UUID_B,
      agg: "sum",
      format,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect((parsed.data as { format?: unknown }).format).toEqual(format);
  });

  test("rollup rejects unknown agg kind", () => {
    expect(rollupHandler.configSchema.safeParse({ agg: "median" }).success).toBe(false);
  });
});
