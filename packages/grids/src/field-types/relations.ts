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
  /** Table whose records this relation links to. Optional at create time
   *  so a user can add the field first and pick the target table from the
   *  per-field config editor afterwards — matches lookup/rollup. */
  targetTableId: z.string().uuid().optional(),
  /** Cardinality. Phase 4 always stores arrays; "single" caps to 1. */
  cardinality: z.enum(["single", "multiple"]).optional(),
});

type RelationConfig = z.infer<typeof RelationConfigSchema>;

const emptyRelationValue = (raw: unknown): boolean => raw === null || raw === undefined;

const validateEmptyRelation = (required: boolean) => (required ? fail("required") : ok(null));

const parseRelationConfig = (configRaw: unknown) => {
  const parsed = RelationConfigSchema.safeParse(configRaw ?? {});
  return parsed.success ? ok(parsed.data) : fail("invalid relation config");
};

const validateConfiguredTarget = (raw: unknown, config: RelationConfig, required: boolean) => {
  if (config.targetTableId) return null;
  return emptyRelationValue(raw) ? validateEmptyRelation(required) : fail("relation has no target table configured yet");
};

const parseUuidString = (value: string) => (UUID_RE.test(value) ? ok(value) : fail("must be a record uuid"));

const parseUuidArray = (raw: unknown[]): ReturnType<typeof ok<string[]>> | ReturnType<typeof fail> => {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") return fail("each link must be a uuid string");
    if (!UUID_RE.test(item)) return fail(`"${item}" is not a record uuid`);
    if (seen.has(item)) continue;
    seen.add(item);
    ids.push(item);
  }
  return ok(ids);
};

const normalizeRelationValue = (raw: unknown): ReturnType<typeof ok<string[]>> | ReturnType<typeof fail> => {
  if (typeof raw === "string") {
    const uuid = parseUuidString(raw);
    return uuid.ok ? ok([uuid.value]) : uuid;
  }
  if (Array.isArray(raw)) return parseUuidArray(raw);
  return fail("must be a record uuid or array of record uuids");
};

const validateCardinality = (ids: string[], config: RelationConfig) =>
  (config.cardinality ?? "multiple") === "single" && ids.length > 1
    ? fail("single-cardinality relation accepts at most one link")
    : ok(ids);

export const relationHandler: FieldTypeHandler = {
  type: "relation",
  configSchema: RelationConfigSchema,
  userInput: true,
  validate(raw, configRaw, required) {
    const config = parseRelationConfig(configRaw);
    if (!config.ok) return config;

    const targetError = validateConfiguredTarget(raw, config.value, required);
    if (targetError) return targetError;
    if (emptyRelationValue(raw)) return validateEmptyRelation(required);

    const ids = normalizeRelationValue(raw);
    if (!ids.ok) return ids;
    if (ids.value.length === 0) return validateEmptyRelation(required);

    return validateCardinality(ids.value, config.value);
  },
};

// ── lookup ────────────────────────────────────────────────────────
// Read-only: pulls the configured display field from related records.
// userInput is false; the value gets populated by the records service
// at read time via batch-fetching the linked records.
const LookupConfigSchema = z.object({
  /** ID of the relation field on this table to follow. Optional so the
   *  field can be created first and wired up via the config editor. The
   *  enrichment pipeline already skips lookups whose config is incomplete. */
  relationFieldId: z.string().uuid().optional(),
  /** ID of the field on the related table whose value we project. */
  targetFieldId: z.string().uuid().optional(),
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
  /** All three are optional at create time — defaultConfigForType returns
   *  `{}` and the user fills them in via the per-field config editor.
   *  The enrichment pipeline skips rollups whose config is incomplete. */
  relationFieldId: z.string().uuid().optional(),
  targetFieldId: z.string().uuid().optional(),
  agg: z.enum(["count", "sum", "avg", "min", "max"]).optional(),
});

export const rollupHandler: FieldTypeHandler = {
  type: "rollup",
  configSchema: RollupConfigSchema,
  userInput: false,
  validate: () => fail("rollup is read-only — derived from the relation"),
};
