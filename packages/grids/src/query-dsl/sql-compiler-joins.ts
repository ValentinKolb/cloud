import { sql } from "bun";
import type { DslResolvedRelationJoin } from "./resolver";
import type { DslSqlCompileOptions } from "./sql-compiler-types";

export const dslJoinRecordAlias = (index: number): string => `jq${index}`;

const joinLinkAlias = (index: number): string => `jql${index}`;

const boundedPositiveInt = (value: number | undefined, fallback: number, max: number): number =>
  Math.min(Math.max(value ?? fallback, 1), max);

export const compileRelationJoin = (
  join: DslResolvedRelationJoin,
  index: number,
  joinAliases: Map<string, string>,
  options: Pick<DslSqlCompileOptions, "joinFanoutLimit"> = {},
): { ok: true; fragment: unknown; recordAlias: string } | { ok: false; error: string } => {
  const fromAlias = join.fromScope ? joinAliases.get(join.fromScope) : "r";
  if (!fromAlias) return { ok: false, error: `join "${join.alias}" depends on unknown join alias "${join.fromScope}"` };

  const linkAlias = joinLinkAlias(index);
  const recordAlias = dslJoinRecordAlias(index);
  const joinSql = join.mode === "left" ? sql`LEFT JOIN` : sql`JOIN`;
  const fanoutLimit = options.joinFanoutLimit ? boundedPositiveInt(options.joinFanoutLimit, 50, 500) : null;
  const linkSourceColumn = join.direction === "reverse" ? "from_record_id" : "to_record_id";
  const linkMatchColumn = join.direction === "reverse" ? "to_record_id" : "from_record_id";
  const linkJoin = fanoutLimit
    ? sql`
      ${joinSql} LATERAL (
        SELECT ${sql.unsafe(`_dsl_link.${linkSourceColumn}`)}
        FROM grids.record_links _dsl_link
        WHERE ${sql.unsafe(`_dsl_link.${linkMatchColumn}`)} = ${sql.unsafe(fromAlias)}.id
          AND _dsl_link.from_field_id = ${join.relationFieldId}::uuid
        ORDER BY ${sql.unsafe(`_dsl_link.${linkSourceColumn}`)}
        LIMIT ${fanoutLimit}
      ) ${sql.unsafe(linkAlias)} ON TRUE
    `
    : sql`
      ${joinSql} grids.record_links ${sql.unsafe(linkAlias)}
        ON ${sql.unsafe(`${linkAlias}.${linkMatchColumn}`)} = ${sql.unsafe(fromAlias)}.id
       AND ${sql.unsafe(linkAlias)}.from_field_id = ${join.relationFieldId}::uuid
    `;

  return {
    ok: true,
    recordAlias,
    fragment: sql`
      ${linkJoin}
      ${joinSql} grids.records ${sql.unsafe(recordAlias)}
        ON ${sql.unsafe(recordAlias)}.id = ${sql.unsafe(`${linkAlias}.${linkSourceColumn}`)}
       AND ${sql.unsafe(recordAlias)}.table_id = ${join.tableId}::uuid
       AND ${sql.unsafe(recordAlias)}.deleted_at IS NULL
       AND EXISTS (
         SELECT 1
         FROM grids.tables ${sql.unsafe(`${recordAlias}_t`)}
         JOIN grids.bases ${sql.unsafe(`${recordAlias}_b`)}
           ON ${sql.unsafe(`${recordAlias}_b`)}.id = ${sql.unsafe(`${recordAlias}_t`)}.base_id
          AND ${sql.unsafe(`${recordAlias}_b`)}.deleted_at IS NULL
         WHERE ${sql.unsafe(`${recordAlias}_t`)}.id = ${sql.unsafe(recordAlias)}.table_id
           AND ${sql.unsafe(`${recordAlias}_t`)}.deleted_at IS NULL
       )
    `,
  };
};
