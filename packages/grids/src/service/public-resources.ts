import { err, fail, ok, type Result } from "@k2b/stdlib";
import { type SQL, sql } from "bun";
import { ShortIdSchema } from "../contracts";
import { listByTable } from "./field-read";

export type PublicResourceType =
  | "base"
  | "table"
  | "field"
  | "record"
  | "comment"
  | "file"
  | "view"
  | "form"
  | "documentTemplate"
  | "documentRun"
  | "documentSnapshot"
  | "documentLink"
  | "emailTemplate"
  | "customApp"
  | "workflow"
  | "workflowLauncher"
  | "workflowRun";

const resources: Record<PublicResourceType, { table: string; key: string; live: string }> = {
  base: { table: "bases", key: "id", live: "deleted_at IS NULL" },
  table: { table: "tables", key: "id", live: "deleted_at IS NULL" },
  field: { table: "fields", key: "id", live: "deleted_at IS NULL" },
  record: { table: "records", key: "id", live: "deleted_at IS NULL" },
  comment: { table: "record_comments", key: "id", live: "deleted_at IS NULL" },
  file: { table: "files", key: "id", live: "TRUE" },
  view: { table: "views", key: "id", live: "deleted_at IS NULL" },
  form: { table: "forms", key: "id", live: "deleted_at IS NULL" },
  documentTemplate: { table: "document_templates", key: "id", live: "deleted_at IS NULL" },
  documentRun: { table: "document_runs", key: "id", live: "TRUE" },
  documentSnapshot: { table: "record_snapshots", key: "id", live: "TRUE" },
  documentLink: { table: "document_links", key: "id", live: "TRUE" },
  emailTemplate: { table: "email_templates", key: "id", live: "deleted_at IS NULL" },
  customApp: { table: "custom_apps", key: "id", live: "deleted_at IS NULL" },
  workflow: { table: "workflow_profile", key: "id", live: "deleted_at IS NULL" },
  workflowLauncher: { table: "workflow_launchers", key: "id", live: "deleted_at IS NULL" },
  workflowRun: { table: "workflow_run_profile", key: "run_id", live: "TRUE" },
};

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** Resolves public IDs in one query. The returned map is keyed by public ID. */
export const resolvePublicIds = async (
  type: PublicResourceType,
  publicIds: readonly string[],
  db: SQL = sql,
): Promise<Map<string, string>> => {
  const ids = unique(publicIds).map((id) => ShortIdSchema.parse(id));
  if (ids.length === 0) return new Map();
  const resource = resources[type];
  const rows = (await db.unsafe(
    `SELECT short_id AS "publicId", ${resource.key}::text AS "internalId"
       FROM grids.${resource.table}
      WHERE short_id = ANY($1::text[]) AND ${resource.live}`,
    [ids],
  )) as Array<{ publicId: string; internalId: string }>;
  return new Map(rows.map((row) => [row.publicId, row.internalId]));
};

/** Projects internal IDs to public IDs in one query. The returned map is keyed by internal UUID. */
export const projectPublicIds = async (
  type: PublicResourceType,
  internalIds: readonly string[],
  db: SQL = sql,
): Promise<Map<string, string>> => {
  const ids = unique(internalIds);
  if (ids.length === 0) return new Map();
  const resource = resources[type];
  const rows = (await db.unsafe(
    `SELECT ${resource.key}::text AS "internalId", short_id AS "publicId"
       FROM grids.${resource.table}
      WHERE ${resource.key} = ANY($1::uuid[])`,
    [ids],
  )) as Array<{ internalId: string; publicId: string }>;
  return new Map(rows.map((row) => [row.internalId, row.publicId]));
};

export const resolvePublicId = async (type: PublicResourceType, publicId: string, db: SQL = sql): Promise<string | null> =>
  (await resolvePublicIds(type, [publicId], db)).get(publicId) ?? null;

/** Resolves a stored public ID, including a soft-deleted tombstone. Admin restore flows only. */
export const resolveStoredPublicId = async (type: PublicResourceType, publicId: string, db: SQL = sql): Promise<string | null> => {
  const parsed = ShortIdSchema.safeParse(publicId);
  if (!parsed.success) return null;
  const resource = resources[type];
  const rows = (await db.unsafe(`SELECT ${resource.key}::text AS "internalId" FROM grids.${resource.table} WHERE short_id = $1 LIMIT 1`, [
    parsed.data,
  ])) as Array<{ internalId: string }>;
  return rows[0]?.internalId ?? null;
};

export const projectPublicId = async (type: PublicResourceType, internalId: string, db: SQL = sql): Promise<string | null> =>
  (await projectPublicIds(type, [internalId], db)).get(internalId) ?? null;

/** Converts public field keys and relation-record IDs before domain validation. */
export const fromPublicRecordValues = async (
  tableId: string,
  values: Record<string, unknown>,
  options: { allowTemporaryRelationIds?: boolean } = {},
): Promise<Result<Record<string, unknown>>> => {
  const fields = await listByTable(tableId);
  const fieldsByPublicId = new Map(fields.map((field) => [field.shortId, field]));
  const relationPublicIds: string[] = [];
  for (const [fieldPublicId, value] of Object.entries(values)) {
    if (!ShortIdSchema.safeParse(fieldPublicId).success) return fail(err.badInput("Invalid field ID"));
    const field = fieldsByPublicId.get(fieldPublicId);
    if (!field) return fail(err.badInput("Unknown field"));
    if (field.type !== "relation") continue;
    const ids = Array.isArray(value) ? value : value === null ? [] : [value];
    for (const id of ids) {
      if (options.allowTemporaryRelationIds && typeof id === "string" && id.startsWith("tmp_")) continue;
      const parsed = ShortIdSchema.safeParse(id);
      if (!parsed.success) return fail(err.badInput("Invalid related record ID"));
      relationPublicIds.push(parsed.data);
    }
  }
  const relatedRecords = await resolvePublicIds("record", relationPublicIds);
  if (relatedRecords.size !== new Set(relationPublicIds).size) return fail(err.badInput("Unknown related record"));
  const internal: Record<string, unknown> = {};
  for (const [fieldPublicId, value] of Object.entries(values)) {
    const field = fieldsByPublicId.get(fieldPublicId)!;
    internal[field.id] =
      field.type === "relation"
        ? Array.isArray(value)
          ? value.map((id) =>
              options.allowTemporaryRelationIds && typeof id === "string" && id.startsWith("tmp_") ? id : relatedRecords.get(id as string)!,
            )
          : typeof value === "string"
            ? options.allowTemporaryRelationIds && value.startsWith("tmp_")
              ? value
              : relatedRecords.get(value)!
            : value
        : value;
  }
  return ok(internal);
};
