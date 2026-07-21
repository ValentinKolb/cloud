import type { AccessSubject } from "@valentinkolb/cloud/server";
import { escapeLikePattern, toPgUuidArray } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { z } from "zod";
import type { LinkedSpaceSummary, MailSpaceCandidatesQuery, MailSpaceCandidatesResponse, ResolveMailSpacesResponse } from "../integration";
import { buildSpacePrincipalCondition, isSpaceResourceId } from "./access";

const cursorSchema = z.object({ version: z.literal(1), name: z.string(), id: z.uuid() }).strict();
type CandidateCursor = z.infer<typeof cursorSchema>;

type SummaryRow = {
  id: string;
  name: string;
  color: string | null;
  updated_at: Date;
};

const mapSummary = (row: SummaryRow): LinkedSpaceSummary => ({
  id: row.id,
  name: row.name,
  color: row.color,
  href: `/app/spaces/${encodeURIComponent(row.id)}`,
  updatedAt: row.updated_at.toISOString(),
});

const encodeCursor = (row: SummaryRow): string =>
  Buffer.from(JSON.stringify({ version: 1, name: row.name.toLowerCase(), id: row.id } satisfies CandidateCursor)).toString("base64url");

const decodeCursor = (value?: string): Result<CandidateCursor | null> => {
  if (!value) return ok(null);
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success ? ok(parsed.data) : fail(err.badInput("Invalid Spaces integration cursor"));
  } catch {
    return fail(err.badInput("Invalid Spaces integration cursor"));
  }
};

const accessSql = (subject: AccessSubject, boundSpaceId: string | null) => ({
  principal: buildSpacePrincipalCondition(subject),
  binding: subject.type === "service_account" ? sql`s.id = ${boundSpaceId}::uuid` : sql`true`,
});

export const resolveMailSpaces = async (params: {
  subject: AccessSubject;
  boundSpaceId: string | null;
  spaceIds: string[];
}): Promise<ResolveMailSpacesResponse> => {
  if (params.subject.type === "service_account" && !isSpaceResourceId(params.boundSpaceId)) return { items: [] };
  const access = accessSql(params.subject, params.boundSpaceId);
  const rows = await sql<SummaryRow[]>`
    SELECT DISTINCT s.id, s.name, s.color, s.updated_at
    FROM spaces.spaces s
    JOIN spaces.space_access sa ON sa.space_id = s.id
    JOIN auth.access a ON a.id = sa.access_id
    WHERE s.id = ANY(${toPgUuidArray(params.spaceIds)}::uuid[])
      AND a.permission IN ('read'::auth.permission_level, 'write'::auth.permission_level, 'admin'::auth.permission_level)
      AND ${access.principal}
      AND ${access.binding}
    ORDER BY s.id
  `;
  return { items: rows.map(mapSummary) };
};

export const listMailSpaceCandidates = async (params: {
  subject: AccessSubject;
  boundSpaceId: string | null;
  query: MailSpaceCandidatesQuery;
}): Promise<Result<MailSpaceCandidatesResponse>> => {
  if (params.subject.type === "service_account" && !isSpaceResourceId(params.boundSpaceId)) return ok({ items: [], nextCursor: null });
  const cursor = decodeCursor(params.query.cursor);
  if (!cursor.ok) return cursor;
  const access = accessSql(params.subject, params.boundSpaceId);
  const search = params.query.q ? `%${escapeLikePattern(params.query.q.toLowerCase())}%` : null;
  const limit = params.query.limit;

  const rows = await sql<SummaryRow[]>`
    SELECT DISTINCT s.id, s.name, s.color, s.updated_at
    FROM spaces.spaces s
    JOIN spaces.space_access sa ON sa.space_id = s.id
    JOIN auth.access a ON a.id = sa.access_id
    WHERE a.permission IN ('read'::auth.permission_level, 'write'::auth.permission_level, 'admin'::auth.permission_level)
      AND ${access.principal}
      AND ${access.binding}
      AND (${search}::text IS NULL OR LOWER(s.name) LIKE ${search} ESCAPE '\\')
      AND (${cursor.data?.name ?? null}::text IS NULL OR (LOWER(s.name), s.id) > (${cursor.data?.name ?? null}::text, ${cursor.data?.id ?? null}::uuid))
    GROUP BY s.id
    ORDER BY LOWER(s.name), s.id
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return ok({ items: page.map(mapSummary), nextCursor: hasMore && last ? encodeCursor(last) : null });
};
