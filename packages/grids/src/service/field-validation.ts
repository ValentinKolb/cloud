import { type DateContext, dates, err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { getFieldType, getRecordWritableFieldType } from "../field-types";
import type { Field } from "./types";

export const validateFieldConfig = (type: string, config: Record<string, unknown>): Result<unknown> => {
  const fieldType = getFieldType(type);
  if (!fieldType) return fail(err.badInput(`unknown field type "${type}"`));
  const parsed = fieldType.configSchema.safeParse(config);
  if (!parsed.success) {
    // Surface the first issue's message so users see WHY the config was
    // rejected (e.g. "decimal places cannot exceed precision") instead of a
    // generic "invalid config".
    const firstIssue = parsed.error.issues[0];
    const detail = firstIssue?.message ?? "invalid config";
    return fail(err.badInput(`invalid config for type "${type}": ${detail}`));
  }
  return ok(parsed.data);
};

const isDateNowDefault = (value: unknown): value is { kind: "now" } =>
  typeof value === "object" &&
  value !== null &&
  (value as { kind?: unknown }).kind === "now" &&
  Object.keys(value as Record<string, unknown>).length === 1;

export const materializeFieldDefault = (field: Field, options: { dateConfig?: DateContext; now?: Date } = {}): unknown => {
  if (field.type !== "date" || !isDateNowDefault(field.defaultValue)) return field.defaultValue;
  const includeTime = (field.config as { includeTime?: boolean }).includeTime ?? false;
  const now = options.now ?? new Date();
  return includeTime ? now.toISOString() : dates.formatDateKey(now, options.dateConfig);
};

export const validateDefaultValue = (type: string, config: Record<string, unknown>, value: unknown): Result<unknown> => {
  if (value === undefined || value === null) return ok(null);
  if (type === "date" && isDateNowDefault(value)) return ok(value);
  if (typeof value === "object" && value !== null && "kind" in value) {
    return fail(err.badInput("invalid default"));
  }
  const fieldType = getRecordWritableFieldType(type);
  if (!fieldType) return fail(err.badInput(`field type "${type}" does not support defaults`));
  const v = fieldType.validate(value, config, false);
  if (!v.ok) return fail(err.badInput(`invalid default: ${v.error}`));
  return ok(v.value);
};

/**
 * DB-context validation for relation / lookup / rollup configs. Only
 * the field service knows the source field's table + base, so this
 * lives here rather than in the per-handler configSchema (which is
 * shape-only). Closes chunk 5 critical "Relation configs can point
 * across base boundaries" — a base-admin who knew another base's
 * table UUID could wire a relation at it and exfiltrate data through
 * lookup/labels.
 *
 * Same-base only: target table must share the source field's base.
 * Cross-table consistency: lookup/rollup relationFieldId must be a
 * relation on the source table; targetFieldId must belong to that
 * relation's target table.
 */
export const validateLinkOrComputedConfig = async (
  type: string,
  config: Record<string, unknown>,
  sourceTableId: string,
): Promise<Result<void>> => {
  if (type !== "relation" && type !== "lookup" && type !== "rollup") return ok();

  // Resolve source table's base scope once.
  const [sourceTable] = await sql<{ base_id: string }[]>`
    SELECT base_id::text AS base_id FROM grids.tables WHERE id = ${sourceTableId}::uuid AND deleted_at IS NULL
  `;
  if (!sourceTable) return fail(err.badInput("source table not found"));
  const baseId = sourceTable.base_id;

  if (type === "relation") {
    const cfg = config as { targetTableId?: string };
    if (!cfg.targetTableId) return ok(); // pre-config; field can be created and wired up later.

    const [target] = await sql<{ base_id: string }[]>`
      SELECT base_id::text AS base_id FROM grids.tables
      WHERE id = ${cfg.targetTableId}::uuid AND deleted_at IS NULL
    `;
    if (!target) return fail(err.badInput("relation target table not found"));
    if (target.base_id !== baseId) {
      return fail(err.badInput("relation target must be in the same base as the source"));
    }
    return ok();
  }

  // lookup / rollup
  const cfg = config as { relationFieldId?: string; targetFieldId?: string };
  if (!cfg.relationFieldId || !cfg.targetFieldId) return ok(); // pre-config

  const [relField] = await sql<{ table_id: string; type: string; config: unknown }[]>`
    SELECT table_id::text AS table_id, type, config
    FROM grids.fields WHERE id = ${cfg.relationFieldId}::uuid AND deleted_at IS NULL
  `;
  if (!relField) return fail(err.badInput("relationFieldId not found"));
  if (relField.type !== "relation") {
    return fail(err.badInput("relationFieldId must point to a relation field"));
  }
  if (relField.table_id !== sourceTableId) {
    return fail(err.badInput("relationFieldId must be on the same table as this lookup/rollup"));
  }
  const relTargetTableId = (relField.config as { targetTableId?: string } | null)?.targetTableId;
  if (!relTargetTableId) {
    return fail(err.badInput("the chosen relation has no target table configured yet"));
  }
  const [targetField] = await sql<{ table_id: string }[]>`
    SELECT table_id::text AS table_id FROM grids.fields
    WHERE id = ${cfg.targetFieldId}::uuid AND deleted_at IS NULL
  `;
  if (!targetField) return fail(err.badInput("targetFieldId not found"));
  if (targetField.table_id !== relTargetTableId) {
    return fail(err.badInput("targetFieldId must belong to the relation's target table"));
  }
  return ok();
};
