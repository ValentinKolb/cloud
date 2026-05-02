import { sql } from "bun";

export type FieldDependent = {
  /** Kind of resource that references the field. */
  type: "view" | "form" | "formula" | "lookup" | "rollup" | "relation_display";
  /** ID of the dependent resource. */
  resourceId: string;
  /** Human label for error messages. */
  resourceName: string;
  /** Where in the resource the reference lives ("filter", "sort", etc). */
  context?: string;
  /**
   * If true, mutating the field requires the user to remove this dep first.
   * If false, the field-mutation path can auto-cleanup the reference.
   *
   * Today: views and forms auto-cleanup. Formulas/lookups/rollups/relation
   * displays block (Phase 4/5 introduces them — kept here for forward-compat).
   */
  blocking: boolean;
};

type DbRow = Record<string, unknown>;

export const findFieldRefsInValue = (value: unknown, fieldId: string): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value === fieldId;
  if (Array.isArray(value)) return value.some((v) => findFieldRefsInValue(v, fieldId));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) =>
      findFieldRefsInValue(v, fieldId),
    );
  }
  return false;
};

export const findFieldRefContexts = (config: Record<string, unknown>, fieldId: string): string[] => {
  const contexts: string[] = [];
  // Common keys in view configs that may reference fields.
  const keys = ["filter", "sort", "visibleFields", "fieldOrder", "fieldWidths", "groupBy"];
  for (const key of keys) {
    const part = config[key];
    if (part !== undefined && findFieldRefsInValue(part, fieldId)) {
      contexts.push(key);
    }
  }
  return contexts;
};

/**
 * Returns all resources that reference a field. Required pre-flight check
 * before mutating or deleting the field. Mutation paths consume the result
 * to either auto-cleanup non-blocking refs or surface a "remove dependent
 * first" error to the user.
 */
export const getFieldDependents = async (fieldId: string): Promise<FieldDependent[]> => {
  const dependents: FieldDependent[] = [];

  // ── views ─────────────────────────────────────────────
  const viewRows = await sql<DbRow[]>`
    SELECT v.id, v.name, v.config
    FROM grids.views v
    JOIN grids.fields f ON f.table_id = v.table_id
    WHERE f.id = ${fieldId}::uuid
  `;
  for (const row of viewRows) {
    const config = (row.config as Record<string, unknown>) ?? {};
    const contexts = findFieldRefContexts(config, fieldId);
    for (const context of contexts) {
      dependents.push({
        type: "view",
        resourceId: row.id as string,
        resourceName: row.name as string,
        context,
        blocking: false,
      });
    }
  }

  // ── forms ─────────────────────────────────────────────
  // Forms persist field IDs inside their config.fields[]. Keep the scan
  // here so deleting a field auto-cleans form references (UI promises it).
  const formRows = await sql<DbRow[]>`
    SELECT fo.id, fo.name, fo.config
    FROM grids.forms fo
    JOIN grids.fields f ON f.table_id = fo.table_id
    WHERE f.id = ${fieldId}::uuid
  `;
  for (const row of formRows) {
    const config = (row.config as { fields?: Array<{ fieldId?: string }> }) ?? {};
    const refs = (config.fields ?? []).filter((f) => f.fieldId === fieldId);
    if (refs.length > 0) {
      dependents.push({
        type: "form",
        resourceId: row.id as string,
        resourceName: row.name as string,
        context: "fields",
        blocking: false,
      });
    }
  }

  // Phase 4/5 will add formula / lookup / rollup / relation_display scans
  // (those produce blocking deps).

  return dependents;
};

/** True if any dependent is blocking — i.e. user must remove deps before mutating. */
export const hasBlockingDependents = (deps: FieldDependent[]): boolean =>
  deps.some((d) => d.blocking);
