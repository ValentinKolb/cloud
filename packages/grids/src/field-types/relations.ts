import { z } from "zod";
import { fail, ok, type FieldTypeHandler } from "./types";

// ─────────────────────────────────────────────────────────────────
// Phase 4 — relation / lookup / rollup field types
// ─────────────────────────────────────────────────────────────────
// Relations store an array of target-record-ids inline in `data` (KISS:
// no junction-table write path yet). Lookup + rollup are read-only:
// they don't accept user input and the records service computes their
// display values at list-time by following the configured relation.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RelationConfigSchema = z.object({
  /** Table whose records this relation links to. */
  targetTableId: z.string().uuid(),
  /** Field on the target table used as the display label (Phase 4a:
   *  callers project it themselves; Phase 4b's lookup uses this too). */
  displayFieldId: z.string().uuid().optional(),
  /** Cardinality. Phase 4 always stores arrays; "single" caps to 1. */
  cardinality: z.enum(["single", "multiple"]).optional(),
});

export const relationHandler: FieldTypeHandler = {
  type: "relation",
  configSchema: RelationConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const parsed = RelationConfigSchema.safeParse(configRaw ?? {});
    if (!parsed.success) return fail("invalid relation config (targetTableId required)");
    const config = parsed.data;
    const cardinality = config.cardinality ?? "multiple";

    if (raw === null || raw === undefined) return required ? fail("required") : ok(null);

    // Accept either a single uuid string (sugared) or an array.
    let arr: string[];
    if (typeof raw === "string") {
      if (!UUID_RE.test(raw)) return fail("must be a record uuid");
      arr = [raw];
    } else if (Array.isArray(raw)) {
      arr = [];
      const seen = new Set<string>();
      for (const item of raw) {
        if (typeof item !== "string") return fail("each link must be a uuid string");
        if (!UUID_RE.test(item)) return fail(`"${item}" is not a record uuid`);
        if (!seen.has(item)) {
          seen.add(item);
          arr.push(item);
        }
      }
    } else {
      return fail("must be a record uuid or array of record uuids");
    }

    if (arr.length === 0) return required ? fail("required") : ok(null);
    if (cardinality === "single" && arr.length > 1) {
      return fail("single-cardinality relation accepts at most one link");
    }
    return ok(arr);
  },
};

// ── lookup ────────────────────────────────────────────────────────
// Read-only: pulls the configured display field from related records.
// userInput is false; the value gets populated by the records service
// at read time via batch-fetching the linked records.
const LookupConfigSchema = z.object({
  /** ID of the relation field on this table to follow. */
  relationFieldId: z.string().uuid(),
  /** ID of the field on the related table whose value we project. */
  targetFieldId: z.string().uuid(),
});

export const lookupHandler: FieldTypeHandler = {
  type: "lookup",
  configSchema: LookupConfigSchema,
  userInput: false,
  validate: () => fail("lookup is read-only — set value via the relation"),
};

// ── rollup ────────────────────────────────────────────────────────
// Read-only aggregate over related records. agg is constrained to the
// shapes that make sense for arbitrary related fields.
const RollupConfigSchema = z.object({
  relationFieldId: z.string().uuid(),
  targetFieldId: z.string().uuid(),
  agg: z.enum(["count", "sum", "avg", "min", "max"]),
});

export const rollupHandler: FieldTypeHandler = {
  type: "rollup",
  configSchema: RollupConfigSchema,
  userInput: false,
  validate: () => fail("rollup is read-only — derived from the relation"),
};
