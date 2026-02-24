import { sql } from "bun";
import { logger } from "@valentinkolb/cloud/core/services";
import { err, fail, ok, paginate, type PageParams, type Paginated, type Result } from "@valentinkolb/cloud/lib/server";
import type { TermsVersion } from "@/terms/contracts";

const log = logger("terms");

type DbRow = {
  id: string;
  content: string;
  created_at: string | Date;
};

/**
 * Converts one `terms.versions` row into the `TermsVersion` DTO used by API and UI.
 */
const mapRow = (row: DbRow): TermsVersion => ({
  id: row.id,
  content: row.content,
  createdAt: new Date(row.created_at).toISOString(),
});

const paginateItems = <T>(items: T[], pagination?: PageParams): Paginated<T> => {
  if (!pagination) {
    return {
      items,
      page: 1,
      perPage: items.length,
      total: items.length,
      hasNext: false,
    };
  }

  const { page, perPage, offset } = paginate(pagination);
  const sliced = items.slice(offset, offset + perPage);
  return {
    items: sliced,
    page,
    perPage,
    total: items.length,
    hasNext: page * perPage < items.length,
  };
};

/**
 * Lists published terms versions with optional content search and pagination.
 */
const list = async (config?: { pagination?: PageParams; filter?: { query?: string } }): Promise<Paginated<TermsVersion>> => {
  const rows = await sql`
    SELECT * FROM terms.versions
    ORDER BY created_at DESC
  `;

  const versions = (rows as DbRow[]).map(mapRow);
  const query = config?.filter?.query?.trim().toLowerCase();
  const filtered = query && query.length > 0 ? versions.filter((version) => version.content.toLowerCase().includes(query)) : versions;

  return paginateItems(filtered, config?.pagination);
};

/**
 * Returns the newest terms version by reusing the paginated list query.
 */
const latest = async (): Promise<TermsVersion | null> => {
  const latestPage = await list({ pagination: { page: 1, perPage: 1 } });
  return latestPage.items[0] ?? null;
};

/**
 * Returns one terms version by UUID, or `null` when it does not exist.
 */
const get = async (config: { id: string }): Promise<TermsVersion | null> => {
  const [row] = await sql`
    SELECT * FROM terms.versions
    WHERE id = ${config.id}::uuid
  `;
  return row ? mapRow(row as DbRow) : null;
};

/**
 * Creates a new terms version and records the publishing user as author.
 */
const create = async (config: { content: string }): Promise<Result<TermsVersion>> => {
  try {
    const [row] = await sql`
      INSERT INTO terms.versions (content)
      VALUES (${config.content})
      RETURNING *
    `;
    return ok(mapRow(row as DbRow));
  } catch (error) {
    log.error("Failed to create terms version", {
      error: (error as Error).message,
    });
    return fail(err.internal("Failed to create terms version"));
  }
};

/**
 * Deletes one version and returns `NOT_FOUND` when the target UUID does not exist.
 */
const remove = async (config: { id: string }): Promise<Result<void>> => {
  try {
    const [existing] = await sql`
      SELECT id FROM terms.versions WHERE id = ${config.id}::uuid
    `;
    if (!existing) return fail(err.notFound("Version"));

    await sql`DELETE FROM terms.versions WHERE id = ${config.id}::uuid`;
    return ok();
  } catch (error) {
    log.error("Failed to delete terms version", {
      error: (error as Error).message,
      id: config.id,
    });
    return fail(err.internal("Failed to delete terms version"));
  }
};

export const termsService = {
  version: {
    list,
    latest,
    get,
    create,
    remove,
  },
};

export type TermsService = typeof termsService;
