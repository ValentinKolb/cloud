import { createHash, randomBytes } from "node:crypto";
import { coreSettings } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { CreateDocumentLinkInput, DocumentLink, DocumentLinkTtl, DocumentRun } from "../contracts";
import { logAudit, type SqlClient } from "./audit";
import { type DocumentDbRow, mapDocumentLink, mapDocumentRun } from "./document-mappers";

const DOCUMENT_LINK_TOKEN_PREFIX = "gdl_";
const DOCUMENT_LINK_TOKEN_BYTES = 32;
const DOCUMENT_LINK_TTL_MS: Record<DocumentLinkTtl, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

const generateDocumentLinkToken = (): string =>
  `${DOCUMENT_LINK_TOKEN_PREFIX}${randomBytes(DOCUMENT_LINK_TOKEN_BYTES).toString("base64url")}`;

const hashDocumentLinkToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const normalizeDocumentLinkToken = (token: string): string | null => {
  const normalized = token.trim();
  if (!normalized.startsWith(DOCUMENT_LINK_TOKEN_PREFIX)) return null;
  if (normalized.length < DOCUMENT_LINK_TOKEN_PREFIX.length + 32 || normalized.length > 160) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(normalized.slice(DOCUMENT_LINK_TOKEN_PREFIX.length))) return null;
  return normalized;
};

const normalizeDocumentLinkComment = (comment: string | null | undefined): string | null => {
  const normalized = comment?.trim() ?? "";
  return normalized ? normalized.slice(0, 500) : null;
};

const documentLinkExpiresAt = (expiresIn: DocumentLinkTtl): Date => new Date(Date.now() + DOCUMENT_LINK_TTL_MS[expiresIn]);

const publicUrlValue = (value: unknown): string => {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
};

export const publicDocumentLinkPath = (token: string): string => `/share/grids/documents/${encodeURIComponent(token)}`;

const publicDocumentLinkOrigin = (appUrl: unknown): string => publicUrlValue(appUrl).replace(/\/+$/, "") || "https://localhost:3000";

export const publicDocumentLinkUrlForAppUrl = (appUrl: unknown, token: string): string =>
  `${publicDocumentLinkOrigin(appUrl)}${publicDocumentLinkPath(token)}`;

export const publicDocumentLinkUrl = async (token: string): Promise<string> =>
  publicDocumentLinkUrlForAppUrl(await coreSettings.get<string>("app.url"), token);

export const listDocumentLinksForRun = async (documentRunId: string): Promise<DocumentLink[]> => {
  const rows = await sql<DocumentDbRow[]>`
    SELECT *
    FROM grids.document_links
    WHERE document_run_id = ${documentRunId}::uuid
    ORDER BY created_at DESC, id DESC
  `;
  return rows.map(mapDocumentLink);
};

export const getDocumentLink = async (linkId: string): Promise<DocumentLink | null> => {
  const [row] = await sql<DocumentDbRow[]>`
    SELECT *
    FROM grids.document_links
    WHERE id = ${linkId}::uuid
  `;
  return row ? mapDocumentLink(row) : null;
};

export const createDocumentLink = async (params: {
  run: DocumentRun;
  input: CreateDocumentLinkInput;
  actorId: string | null;
  ip?: string | null;
  userAgent?: string | null;
  client?: SqlClient;
}): Promise<Result<{ link: DocumentLink; token: string }>> => {
  const token = generateDocumentLinkToken();
  const expiresAt = documentLinkExpiresAt(params.input.expiresIn);
  const comment = normalizeDocumentLinkComment(params.input.comment);
  const create = async (tx: SqlClient): Promise<Result<{ link: DocumentLink; token: string }>> => {
    const [row] = await tx<DocumentDbRow[]>`
      INSERT INTO grids.document_links (
        document_run_id, base_id, table_id, record_id, token_hash, comment, created_by, expires_at
      )
      VALUES (
        ${params.run.id}::uuid,
        ${params.run.baseId}::uuid,
        ${params.run.tableId}::uuid,
        ${params.run.recordId}::uuid,
        ${hashDocumentLinkToken(token)},
        ${comment},
        ${params.actorId}::uuid,
        ${expiresAt}
      )
      RETURNING *
    `;
    if (!row) return fail(err.internal("Could not create document link"));
    const link = mapDocumentLink(row);
    await logAudit(
      {
        baseId: params.run.baseId,
        tableId: params.run.tableId,
        recordId: params.run.recordId,
        userId: params.actorId,
        action: "document_link.created",
        ip: params.ip,
        userAgent: params.userAgent,
        diff: {
          documentRunId: { old: null, new: params.run.id },
          documentLinkId: { old: null, new: link.id },
          expiresAt: { old: null, new: link.expiresAt },
          comment: { old: null, new: link.comment },
        },
      },
      tx,
    );
    return ok({ link, token });
  };
  return params.client ? create(params.client) : sql.begin(create);
};

export const revokeDocumentLink = async (params: {
  linkId: string;
  actorId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<Result<DocumentLink>> => {
  return sql.begin(async (tx) => {
    const [row] = await tx<DocumentDbRow[]>`
      UPDATE grids.document_links
      SET revoked_at = now(), revoked_by = ${params.actorId}::uuid
      WHERE id = ${params.linkId}::uuid AND revoked_at IS NULL
      RETURNING *
    `;
    if (!row) {
      const [existing] = await tx<DocumentDbRow[]>`
        SELECT * FROM grids.document_links WHERE id = ${params.linkId}::uuid
      `;
      return existing ? ok(mapDocumentLink(existing)) : fail(err.notFound("Document link"));
    }
    const link = mapDocumentLink(row);
    await logAudit(
      {
        baseId: link.baseId,
        tableId: link.tableId,
        recordId: link.recordId,
        userId: params.actorId,
        action: "document_link.revoked",
        ip: params.ip,
        userAgent: params.userAgent,
        diff: {
          documentRunId: { old: link.documentRunId, new: link.documentRunId },
          documentLinkId: { old: link.id, new: link.id },
          revokedAt: { old: null, new: link.revokedAt },
        },
      },
      tx,
    );
    return ok(link);
  });
};

export const resolveDocumentLinkDownload = async (token: string): Promise<Result<{ link: DocumentLink; run: DocumentRun }>> => {
  const normalizedToken = normalizeDocumentLinkToken(token);
  if (!normalizedToken) return fail(err.notFound("Document link"));

  const [row] = await sql<DocumentDbRow[]>`
    SELECT *
    FROM grids.document_links
    WHERE token_hash = ${hashDocumentLinkToken(normalizedToken)}
      AND revoked_at IS NULL
      AND expires_at > now()
  `;
  if (!row) return fail(err.notFound("Document link"));
  const link = mapDocumentLink(row);
  const [runRow] = await sql<DocumentDbRow[]>`
    SELECT * FROM grids.document_runs WHERE id = ${link.documentRunId}::uuid
  `;
  if (!runRow) return fail(err.notFound("Document run"));
  return ok({ link, run: mapDocumentRun(runRow) });
};

export const recordDocumentLinkAccess = async (
  linkId: string,
  audit: { ip?: string | null; userAgent?: string | null } = {},
): Promise<Result<DocumentLink>> => {
  return sql.begin(async (tx) => {
    const [row] = await tx<DocumentDbRow[]>`
      UPDATE grids.document_links
      SET access_count = access_count + 1, last_accessed_at = now()
      WHERE id = ${linkId}::uuid
        AND revoked_at IS NULL
        AND expires_at > now()
      RETURNING *
    `;
    if (!row) return fail(err.notFound("Document link"));
    const link = mapDocumentLink(row);

    await logAudit(
      {
        baseId: link.baseId,
        tableId: link.tableId,
        recordId: link.recordId,
        userId: null,
        action: "document_link.accessed",
        ip: audit.ip,
        userAgent: audit.userAgent,
        diff: {
          documentRunId: { old: link.documentRunId, new: link.documentRunId },
          documentLinkId: { old: link.id, new: link.id },
          accessCount: { old: link.accessCount - 1, new: link.accessCount },
        },
      },
      tx,
    );
    return ok(link);
  });
};
