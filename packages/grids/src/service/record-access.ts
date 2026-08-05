import { sql } from "bun";
import type { RecordScope } from "../contracts";

export type AuthorizedRecordAccess =
  | { kind: "all" }
  | { kind: "restricted"; userId: string; scopes: Array<Exclude<RecordScope, { kind: "all" }>> };

export const ALL_RECORD_ACCESS: AuthorizedRecordAccess = { kind: "all" };

/**
 * One index-friendly predicate shared by every stored-record read and write.
 * The relation branch deliberately revalidates the live field and same-base
 * target at runtime: deleting or changing a relation makes the grant match no
 * rows instead of broadening access.
 */
export const recordAccessPredicate = (access: AuthorizedRecordAccess | undefined, alias = "r"): unknown => {
  if (!access || access.kind === "all") return sql`TRUE`;
  const record = sql.unsafe(alias);
  const clauses = access.scopes.map((scope) => {
    if (scope.kind === "created_by") return sql`${record}.created_by = ${access.userId}::uuid`;
    return sql`EXISTS (
      SELECT 1
      FROM grids.record_links access_link
      JOIN grids.fields access_field
        ON access_field.id = access_link.from_field_id
       AND access_field.deleted_at IS NULL
       AND access_field.type = 'relation'
      JOIN grids.tables access_source_table
        ON access_source_table.id = access_field.table_id
       AND access_source_table.deleted_at IS NULL
      JOIN grids.records access_parent
        ON access_parent.id = access_link.to_record_id
       AND access_parent.deleted_at IS NULL
       AND access_parent.created_by = ${access.userId}::uuid
      JOIN grids.tables access_parent_table
        ON access_parent_table.id = access_parent.table_id
       AND access_parent_table.deleted_at IS NULL
       AND access_parent_table.base_id = access_source_table.base_id
      WHERE access_link.from_record_id = ${record}.id
        AND access_link.from_field_id = ${scope.relationFieldId}::uuid
        AND access_field.table_id = ${record}.table_id
        AND access_parent.table_id::text = access_field.config->>'targetTableId'
    )`;
  });
  return clauses.slice(1).reduce((combined, clause) => sql`${combined} OR ${clause}`, clauses[0] ?? sql`FALSE`);
};
