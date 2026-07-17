import { escapeLikePattern } from "@valentinkolb/cloud/services/postgres";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { type MailSearchExpression, mailSearchExpressionSchema, type SearchRequest } from "../contracts";
import type { MailRequestContext } from "./auth";
import { sha256Json } from "./canonical";
import { resolveMailExecution } from "./execution";

type SqlFragment = Bun.SQL.Query<unknown>;

export type MessageSearchHit = {
  id: string;
  conversationId: string | null;
  subject: string;
  messageId: string | null;
  internalDate: string;
  sentAt: string | null;
  from: Array<{ name: string | null; address: string }>;
  to: Array<{ name: string | null; address: string }>;
  flags: string[];
  hasAttachments: boolean;
  snippet: string | null;
  rank: number;
};

export type MessageSearchPage = {
  items: MessageSearchHit[];
  nextCursor: string | null;
  backend: "native" | "pg_textsearch";
};

type DbSearchHit = {
  id: string;
  conversation_id: string | null;
  subject: string;
  message_id: string | null;
  internal_date: Date | string;
  sent_at: Date | string | null;
  from_addresses: unknown[] | string;
  to_addresses: unknown[] | string;
  flags: string[] | null;
  has_attachments: boolean;
  snippet: string | null;
  rank: number | string;
};

type SearchCursor = {
  version: 2;
  sort: "relevance" | "newest";
  backend: "native" | "pg_textsearch";
  queryHash: string;
  rank: number;
  internalDate: string;
  id: string;
};

const encodeCursor = (cursor: SearchCursor): string => Buffer.from(JSON.stringify(cursor)).toString("base64url");

const decodeCursor = (value: string | undefined, sort: SearchCursor["sort"], queryHash: string): Result<SearchCursor | null> => {
  if (!value) return ok(null);
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<SearchCursor>;
    if (
      parsed.version !== 2 ||
      parsed.sort !== sort ||
      (parsed.backend !== "native" && parsed.backend !== "pg_textsearch") ||
      parsed.queryHash !== queryHash ||
      typeof parsed.rank !== "number" ||
      !Number.isFinite(parsed.rank) ||
      typeof parsed.internalDate !== "string" ||
      !Number.isFinite(Date.parse(parsed.internalDate)) ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)
    ) {
      return fail(err.badInput("Invalid search cursor"));
    }
    return ok(parsed as SearchCursor);
  } catch {
    return fail(err.badInput("Invalid search cursor"));
  }
};

export const validateSearchComplexity = (expression: MailSearchExpression): Result<void> => {
  let nodes = 0;
  let queryCharacters = 0;
  let wordCount = 0;
  const visit = (node: MailSearchExpression, depth: number): boolean => {
    nodes += 1;
    if (depth > 8 || nodes > 100) return false;
    if (node.type === "and" || node.type === "or") return node.expressions.every((child) => visit(child, depth + 1));
    if (node.type === "not") return visit(node.expression, depth + 1);
    if (node.type !== "text") return true;
    queryCharacters += node.query.length;
    wordCount += node.query.trim().split(/\s+/u).filter(Boolean).length;
    return queryCharacters <= 5_000 && wordCount <= 500;
  };
  return visit(expression, 1) ? ok() : fail(err.badInput("Search expression is too complex"));
};

const ftsMatch = (document: SqlFragment, query: string, match: "words" | "phrase"): SqlFragment => {
  if (match === "phrase") return sql`${document} @@ phraseto_tsquery('simple', ${query})`;
  return sql`${document} @@ plainto_tsquery('simple', ${query})`;
};

const wordTokens = (query: string): string[] => [...new Set(query.trim().split(/\s+/u).filter(Boolean))];

const bodyChunkMatch = (query: string, match: "words" | "phrase"): SqlFragment => {
  if (match === "phrase") {
    return sql`EXISTS (
      SELECT 1
      FROM mail.message_search_chunks body_chunk
      WHERE body_chunk.message_id = mc.id
        AND body_chunk.search_document @@ phraseto_tsquery('simple', ${query})
    )`;
  }
  const tokens = wordTokens(query).map(
    (token) => sql`EXISTS (
      SELECT 1
      FROM mail.message_search_chunks body_chunk
      WHERE body_chunk.message_id = mc.id
        AND body_chunk.search_document @@ plainto_tsquery('simple', ${token})
    )`,
  );
  return tokens.slice(1).reduce((combined, part) => sql`(${combined} AND ${part})`, tokens[0]!);
};

const textMatch = (value: SqlFragment, query: string, match: "words" | "phrase" | "contains" | "exact"): SqlFragment => {
  if (match === "exact") return sql`lower(COALESCE(${value}, '')) = ${query.toLowerCase()}`;
  const tokens = match === "words" ? wordTokens(query) : [query];
  const parts = tokens.map((token) => sql`lower(COALESCE(${value}, '')) LIKE ${`%${escapeLikePattern(token.toLowerCase())}%`} ESCAPE '\\'`);
  return parts.slice(1).reduce((combined, part) => sql`(${combined} AND ${part})`, parts[0]!);
};

const addressMatch = (
  role: "from" | "to" | "cc" | "bcc" | null,
  query: string,
  match: "words" | "phrase" | "contains" | "exact",
): SqlFragment => {
  const roleClause = role ? sql`ma.role = ${role}` : sql`ma.role IN ('from', 'reply_to', 'to', 'cc', 'bcc')`;
  const valueClause =
    match === "exact"
      ? sql`(lower(ma.email) = ${query.toLowerCase()} OR lower(COALESCE(ma.display_name, '')) = ${query.toLowerCase()})`
      : textMatch(sql`(ma.email || ' ' || COALESCE(ma.display_name, ''))`, query, match);
  return sql`EXISTS (
    SELECT 1 FROM mail.message_addresses ma
    WHERE ma.message_id = mc.id AND ${roleClause} AND ${valueClause}
  )`;
};

const attachmentNameMatch = (query: string, match: Extract<MailSearchExpression, { type: "text" }>["match"]): SqlFragment => sql`EXISTS (
  SELECT 1 FROM mail.attachments attachment
  WHERE attachment.message_id = mc.id AND ${textMatch(sql`attachment.filename`, query, match)}
)`;

const commentMatch = (query: string, match: Extract<MailSearchExpression, { type: "text" }>["match"]): SqlFragment => sql`EXISTS (
  SELECT 1
  FROM mail.conversation_comments comment
  WHERE comment.conversation_id = cm.conversation_id
    AND comment.deleted_at IS NULL
    AND ${textMatch(sql`comment.body_markdown`, query, match)}
)`;

const folderMatch = (query: string, match: Extract<MailSearchExpression, { type: "text" }>["match"]): SqlFragment => sql`EXISTS (
  SELECT 1
  FROM mail.message_placements folder_placement
  JOIN mail.folders folder ON folder.id = folder_placement.folder_id
  LEFT JOIN mail.binding_folder_refs folder_ref ON folder_ref.folder_id = folder.id
  WHERE folder_placement.message_id = mc.id
    AND folder_placement.deleted_at IS NULL
    AND ${textMatch(sql`(folder.name || ' ' || folder.role || ' ' || COALESCE(folder_ref.remote_path, ''))`, query, match)}
)`;

const tagMatch = (query: string, match: Extract<MailSearchExpression, { type: "text" }>["match"]): SqlFragment => sql`EXISTS (
  SELECT 1
  FROM mail.conversation_local_tags assignment
  JOIN mail.local_tags tag ON tag.id = assignment.tag_id AND tag.mailbox_id = assignment.mailbox_id
  WHERE assignment.conversation_id = cm.conversation_id
    AND ${textMatch(sql`tag.name`, query, match)}
)`;

const keywordMatch = (query: string, match: Extract<MailSearchExpression, { type: "text" }>["match"]): SqlFragment => sql`EXISTS (
  SELECT 1
  FROM mail.message_placements keyword_placement
  CROSS JOIN LATERAL unnest(keyword_placement.keywords) keyword(value)
  WHERE keyword_placement.message_id = mc.id
    AND keyword_placement.deleted_at IS NULL
    AND ${textMatch(sql`keyword.value`, query, match)}
)`;

const referenceMatch = (query: string, match: Extract<MailSearchExpression, { type: "text" }>["match"]): SqlFragment => sql`EXISTS (
  SELECT 1
  FROM mail.conversation_references reference
  WHERE reference.conversation_id = cm.conversation_id
    AND ${match === "exact" ? sql`reference.normalized_value = lower(btrim(${query}))` : textMatch(sql`reference.value`, query, match)}
)`;

const combineOr = (parts: SqlFragment[]): SqlFragment =>
  parts.slice(1).reduce((combined, part) => sql`(${combined} OR ${part})`, parts[0]!);

const compileTextTerm = (term: Extract<MailSearchExpression, { type: "text" }>): SqlFragment => {
  const query = term.query.trim();
  if (term.field === "subject") {
    return term.match === "words" || term.match === "phrase"
      ? ftsMatch(sql`mc.subject_search_document`, query, term.match)
      : textMatch(sql`mc.subject`, query, term.match);
  }
  if (term.field === "body") {
    return term.match === "words" || term.match === "phrase"
      ? bodyChunkMatch(query, term.match)
      : textMatch(sql`mc.plain_text`, query, term.match);
  }
  if (term.field === "from" || term.field === "to" || term.field === "cc" || term.field === "bcc") {
    return addressMatch(term.field, query, term.match);
  }
  if (term.field === "recipients") {
    const recipient =
      term.match === "exact"
        ? sql`(lower(ma.email) = ${query.toLowerCase()} OR lower(COALESCE(ma.display_name, '')) = ${query.toLowerCase()})`
        : textMatch(sql`(ma.email || ' ' || COALESCE(ma.display_name, ''))`, query, term.match);
    return sql`EXISTS (
      SELECT 1 FROM mail.message_addresses ma
      WHERE ma.message_id = mc.id AND ma.role IN ('to', 'cc', 'bcc')
        AND ${recipient}
    )`;
  }
  if (term.field === "participants") return addressMatch(null, query, term.match);
  if (term.field === "message_id") return textMatch(sql`mc.message_id`, query, term.match);
  if (term.field === "attachment_name") return attachmentNameMatch(query, term.match);
  if (term.field === "comment") return commentMatch(query, term.match);
  if (term.field === "reference") return referenceMatch(query, term.match);
  if (term.field === "folder") return folderMatch(query, term.match);
  if (term.field === "tag") return tagMatch(query, term.match);
  if (term.field === "keyword") return keywordMatch(query, term.match);

  const body =
    term.match === "words" || term.match === "phrase"
      ? bodyChunkMatch(query, term.match)
      : textMatch(sql`mc.plain_text`, query, term.match);
  const subject =
    term.match === "words" || term.match === "phrase"
      ? ftsMatch(sql`mc.subject_search_document`, query, term.match)
      : textMatch(sql`mc.subject`, query, term.match);
  return combineOr([
    subject,
    body,
    addressMatch(null, query, term.match),
    textMatch(sql`mc.message_id`, query, term.match),
    attachmentNameMatch(query, term.match),
    commentMatch(query, term.match),
    referenceMatch(query, term.match),
    folderMatch(query, term.match),
    tagMatch(query, term.match),
    keywordMatch(query, term.match),
  ]);
};

export const compileSearchExpression = (expression: MailSearchExpression): SqlFragment => {
  if (expression.type === "and") {
    const parts = expression.expressions.map(compileSearchExpression);
    return parts.slice(1).reduce((combined, part) => sql`(${combined} AND ${part})`, parts[0]!);
  }
  if (expression.type === "or") {
    const parts = expression.expressions.map(compileSearchExpression);
    return parts.slice(1).reduce((combined, part) => sql`(${combined} OR ${part})`, parts[0]!);
  }
  if (expression.type === "not") return sql`NOT (${compileSearchExpression(expression.expression)})`;
  if (expression.type === "text") return compileTextTerm(expression);
  if (expression.type === "date") {
    const field = expression.field === "internal_date" ? sql`mc.internal_date` : sql`mc.sent_at`;
    if (expression.operator === "before") return sql`${field} < ${expression.value}::timestamptz`;
    if (expression.operator === "on_or_before") return sql`${field} <= ${expression.value}::timestamptz`;
    if (expression.operator === "after") return sql`${field} > ${expression.value}::timestamptz`;
    return sql`${field} >= ${expression.value}::timestamptz`;
  }
  if (expression.type === "size") {
    const size = expression.field === "message" ? sql`mc.size_bytes` : sql`attachment_size.size_bytes`;
    const comparison =
      expression.operator === "less_than"
        ? sql`${size} < ${expression.bytes}::bigint`
        : expression.operator === "at_most"
          ? sql`${size} <= ${expression.bytes}::bigint`
          : expression.operator === "equal"
            ? sql`${size} = ${expression.bytes}::bigint`
            : expression.operator === "at_least"
              ? sql`${size} >= ${expression.bytes}::bigint`
              : sql`${size} > ${expression.bytes}::bigint`;
    return expression.field === "message"
      ? comparison
      : sql`EXISTS (
          SELECT 1 FROM mail.attachments attachment_size
          WHERE attachment_size.message_id = mc.id AND ${comparison}
        )`;
  }
  if (expression.type === "work_status") {
    return sql`EXISTS (SELECT 1 FROM mail.conversations state WHERE state.id = cm.conversation_id AND state.work_status = ${expression.value})`;
  }
  if (expression.type === "response_needed") {
    return sql`EXISTS (
      SELECT 1 FROM mail.conversations state
      WHERE state.id = cm.conversation_id AND state.response_needed = ${expression.value}
    )`;
  }
  if (expression.type === "assignee") {
    return expression.userId
      ? sql`EXISTS (
          SELECT 1 FROM mail.conversations state
          WHERE state.id = cm.conversation_id AND state.assignee_user_id = ${expression.userId}::uuid
        )`
      : sql`EXISTS (SELECT 1 FROM mail.conversations state WHERE state.id = cm.conversation_id AND state.assignee_user_id IS NULL)`;
  }
  return expression.value
    ? sql`EXISTS (
        SELECT 1 FROM mail.conversations state
        WHERE state.id = cm.conversation_id AND state.snoozed_until > now()
      )`
    : sql`EXISTS (
        SELECT 1 FROM mail.conversations state
        WHERE state.id = cm.conversation_id AND (state.snoozed_until IS NULL OR state.snoozed_until <= now())
      )`;
};

const positiveQueries = (expression: MailSearchExpression, negated = false): string[] => {
  if (expression.type === "and" || expression.type === "or") {
    return expression.expressions.flatMap((child) => positiveQueries(child, negated));
  }
  if (expression.type === "not") return positiveQueries(expression.expression, !negated);
  if (negated || expression.type !== "text" || !["any", "subject", "body"].includes(expression.field)) return [];
  return [expression.query];
};

const parseAddressRows = (value: unknown[] | string): Array<{ name: string | null; address: string }> => {
  const rows = typeof value === "string" ? (JSON.parse(value) as unknown[]) : value;
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    return typeof record["address"] === "string"
      ? [{ name: typeof record["name"] === "string" ? record["name"] : null, address: record["address"] }]
      : [];
  });
};

const mapHit = (row: DbSearchHit): MessageSearchHit => ({
  id: row.id,
  conversationId: row.conversation_id,
  subject: row.subject,
  messageId: row.message_id,
  internalDate: (row.internal_date instanceof Date ? row.internal_date : new Date(row.internal_date)).toISOString(),
  sentAt: row.sent_at ? (row.sent_at instanceof Date ? row.sent_at : new Date(row.sent_at)).toISOString() : null,
  from: parseAddressRows(row.from_addresses),
  to: parseAddressRows(row.to_addresses),
  flags: row.flags ?? [],
  hasAttachments: row.has_attachments,
  snippet: row.snippet,
  rank: Number(row.rank),
});

const detectBackend = async (mailboxId: string): Promise<"native" | "pg_textsearch"> => {
  const [row] = await sql<{ enabled: boolean }[]>`
    SELECT
      m.search_backend <> 'postgres'
      AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_textsearch')
      AND EXISTS (
        SELECT 1
        FROM pg_class index_class
        JOIN pg_am access_method ON access_method.oid = index_class.relam
        JOIN pg_index index_state ON index_state.indexrelid = index_class.oid
        WHERE index_class.oid = to_regclass('mail.message_contents_bm25_idx')
          AND access_method.amname = 'bm25'
          AND index_state.indisvalid
          AND index_state.indisready
          AND index_state.indislive
      ) AS enabled
    FROM mail.mailboxes m
    WHERE m.id = ${mailboxId}::uuid
  `;
  return row?.enabled ? "pg_textsearch" : "native";
};

const runSearch = async (params: {
  db: typeof sql;
  mailboxId: string;
  expression: MailSearchExpression;
  sort: "relevance" | "newest";
  cursor: SearchCursor | null;
  limit: number;
  backend: "native" | "pg_textsearch";
}): Promise<DbSearchHit[]> => {
  const predicate = compileSearchExpression(params.expression);
  const queryText = positiveQueries(params.expression).join(" OR ").slice(0, 4_000);
  const rank =
    params.sort === "newest" || !queryText
      ? sql`0::double precision`
      : params.backend === "pg_textsearch"
        ? sql`-((COALESCE(mc.subject, '') || ' ' || COALESCE(mc.subject, '') || ' ' || COALESCE(mc.plain_text, ''))
            <@> to_bm25query(${queryText}, 'mail.message_contents_bm25_idx'))::double precision`
        : sql`(
            2 * ts_rank_cd(mc.subject_search_document, websearch_to_tsquery('simple', ${queryText}))
            + COALESCE((
              SELECT MAX(ts_rank_cd(rank_chunk.search_document, websearch_to_tsquery('simple', ${queryText})))
              FROM mail.message_search_chunks rank_chunk
              WHERE rank_chunk.message_id = mc.id
            ), 0)
          )::double precision`;
  const snippet = queryText
    ? sql`LEFT(ts_headline(
        'simple',
        COALESCE(mc.plain_text, ''),
        websearch_to_tsquery('simple', ${queryText}),
        'StartSel=, StopSel=, MaxWords=36, MinWords=12, MaxFragments=2, FragmentDelimiter= … '
      ), 500)`
    : sql`NULL::text`;
  const cursor = params.cursor;
  const limit = params.limit + 1;
  return params.db<DbSearchHit[]>`
    WITH matched AS (
      SELECT
        mc.id,
        cm.conversation_id,
        mc.subject,
        mc.message_id,
        mc.internal_date,
        mc.sent_at,
        COALESCE(from_rows.addresses, '[]'::jsonb) AS from_addresses,
        COALESCE(to_rows.addresses, '[]'::jsonb) AS to_addresses,
        COALESCE(placement.flags, ARRAY[]::text[]) AS flags,
        EXISTS (SELECT 1 FROM mail.attachments attachment WHERE attachment.message_id = mc.id) AS has_attachments,
        ${snippet} AS snippet,
        ${rank} AS rank
      FROM mail.message_contents mc
      LEFT JOIN mail.conversation_messages cm ON cm.message_id = mc.id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('name', ma.display_name, 'address', ma.email) ORDER BY ma.position) AS addresses
        FROM mail.message_addresses ma
        WHERE ma.message_id = mc.id AND ma.role = 'from'
      ) from_rows ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('name', ma.display_name, 'address', ma.email) ORDER BY ma.position) AS addresses
        FROM mail.message_addresses ma
        WHERE ma.message_id = mc.id AND ma.role = 'to'
      ) to_rows ON true
      LEFT JOIN LATERAL (
        SELECT mp.flags
        FROM mail.message_placements mp
        WHERE mp.message_id = mc.id AND mp.deleted_at IS NULL
        ORDER BY mp.updated_at DESC
        LIMIT 1
      ) placement ON true
      WHERE mc.mailbox_id = ${params.mailboxId}::uuid
        AND EXISTS (
          SELECT 1 FROM mail.message_placements visible
          WHERE visible.message_id = mc.id AND visible.deleted_at IS NULL
        )
        AND (${predicate})
    )
    SELECT *
    FROM matched
    WHERE (
      ${cursor?.id ?? null}::uuid IS NULL
      OR (
        ${params.sort} = 'relevance'
        AND (
          rank < ${cursor?.rank ?? 0}
          OR (rank = ${cursor?.rank ?? 0} AND (internal_date, id) < (${cursor?.internalDate ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        )
      )
      OR (
        ${params.sort} = 'newest'
        AND (internal_date, id) < (${cursor?.internalDate ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
      )
    )
    ORDER BY
      CASE WHEN ${params.sort} = 'relevance' THEN rank ELSE 0 END DESC,
      internal_date DESC,
      id DESC
    LIMIT ${limit}
  `;
};

const executeSearch = async (params: Omit<Parameters<typeof runSearch>[0], "db">): Promise<DbSearchHit[]> =>
  sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '5s'`;
    return runSearch({ ...params, db: tx });
  });

const searchErrorCode = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
};

const searchFailure = (error: unknown): Result<never> =>
  searchErrorCode(error) === "57014"
    ? fail(err.badInput("Search query exceeded the execution limit"))
    : fail(err.internal("Mail search failed"));

const executeSearchWithFallback = async (params: {
  mailboxId: string;
  expression: MailSearchExpression;
  sort: SearchCursor["sort"];
  cursor: SearchCursor | null;
  limit: number;
  backend: SearchCursor["backend"];
}): Promise<Result<{ rows: DbSearchHit[]; backend: SearchCursor["backend"] }>> => {
  try {
    const rows = await executeSearch(params);
    return ok({ rows, backend: params.backend });
  } catch (error) {
    const mayFallback = params.backend === "pg_textsearch" && !params.cursor && searchErrorCode(error) !== "57014";
    if (!mayFallback) return searchFailure(error);
  }
  try {
    const rows = await executeSearch({ ...params, cursor: null, backend: "native" });
    return ok({ rows, backend: "native" });
  } catch (error) {
    return searchFailure(error);
  }
};

export const searchMessages = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  request: SearchRequest;
}): Promise<Result<MessageSearchPage>> => {
  const parsed = mailSearchExpressionSchema.safeParse(params.request.expression);
  if (!parsed.success) return fail(err.badInput(parsed.error.issues[0]?.message ?? "Invalid search expression"));
  const complexity = validateSearchComplexity(parsed.data);
  if (!complexity.ok) return complexity;
  const access = await resolveMailExecution({ mailboxId: params.mailboxId, operation: "actorRead", context: params.context });
  if (!access.ok) return access;
  const sort = params.request.sort ?? "relevance";
  const queryHash = sha256Json(parsed.data);
  const cursor = decodeCursor(params.request.cursor, sort, queryHash);
  if (!cursor.ok) return cursor;
  const limit = Math.min(Math.max(Math.floor(params.request.limit ?? 50), 1), 100);
  let backend = sort === "newest" ? ("native" as const) : await detectBackend(params.mailboxId);
  if (cursor.data && cursor.data.backend !== backend) {
    if (cursor.data.backend === "native") backend = "native";
    else return fail(err.badInput("Search ranking changed; restart this search from the first page"));
  }
  const execution = await executeSearchWithFallback({
    mailboxId: params.mailboxId,
    expression: parsed.data,
    sort,
    cursor: cursor.data,
    limit,
    backend,
  });
  if (!execution.ok) return execution;
  const rows = execution.data.rows;
  backend = execution.data.backend;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map(mapHit);
  const last = items.at(-1);
  return ok({
    items,
    backend,
    nextCursor:
      hasMore && last
        ? encodeCursor({ version: 2, sort, backend, queryHash, rank: last.rank, internalDate: last.internalDate, id: last.id })
        : null,
  });
};
