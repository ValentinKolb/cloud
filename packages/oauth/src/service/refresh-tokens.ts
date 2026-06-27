import { toPgTextArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import type { OAuthClient, OAuthScope } from "@/contracts";
import * as clients from "./clients";

type RefreshTokenStatus = "active" | "rotated" | "revoked" | "reused";
type RefreshTokenFamilyStatus = "active" | "revoked";

type DbRefreshTokenGrant = {
  id: string;
  family_id: string;
  secret_hash: string;
  status: RefreshTokenStatus;
  generation: number;
  expires_at: Date;
  client_id: string;
  user_id: string;
  scopes: string[];
  audiences: string[];
  family_status: RefreshTokenFamilyStatus;
  family_expires_at: Date;
};

type ParsedRefreshToken = {
  tokenPrefix: string;
  secret: string;
};
type SqlRunner = typeof sql;

export type RefreshTokenRotationResult =
  | {
      ok: true;
      userId: string;
      client: OAuthClient;
      scopes: OAuthScope[];
      audiences: string[];
      refreshToken: string;
      refreshTokenExpiresAt: string;
    }
  | {
      ok: false;
      error: "invalid_grant" | "reuse_detected";
    };

const TOKEN_PREFIX = "cld_rt";
const TOKEN_PATTERN = /^cld_rt_([0-9a-f]{24})_([0-9a-f]{64})$/i;
const REFRESH_TOKEN_LIFETIME_DAYS = 90;

export const shouldIssueRefreshToken = (scopes: OAuthScope[]): boolean => scopes.includes("offline_access");

const nowPlusDays = (days: number): Date => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const randomHex = (bytes: number): string => {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
};

const generateTokenParts = (): { tokenPrefix: string; secret: string; token: string } => {
  const tokenPrefix = randomHex(12);
  const secret = randomHex(32);
  return { tokenPrefix, secret, token: `${TOKEN_PREFIX}_${tokenPrefix}_${secret}` };
};

const parseRefreshToken = (token: string): ParsedRefreshToken | null => {
  const match = token.match(TOKEN_PATTERN);
  if (!match) return null;
  return { tokenPrefix: match[1]!.toLowerCase(), secret: match[2]!.toLowerCase() };
};

const insertRefreshToken = async (params: {
  db: SqlRunner;
  familyId: string;
  generation: number;
  previousTokenId?: string | null;
  expiresAt: Date;
}): Promise<{ id: string; token: string; expiresAt: Date }> => {
  for (let i = 0; i < 5; i += 1) {
    const parts = generateTokenParts();
    const secretHash = await Bun.password.hash(parts.secret);
    const [row] = await params.db<{ id: string }[]>`
      INSERT INTO oauth.refresh_tokens (
        family_id,
        token_prefix,
        secret_hash,
        generation,
        previous_token_id,
        expires_at
      )
      VALUES (
        ${params.familyId}::uuid,
        ${parts.tokenPrefix},
        ${secretHash},
        ${params.generation},
        ${params.previousTokenId ?? null}::uuid,
        ${params.expiresAt}
      )
      ON CONFLICT (token_prefix) DO NOTHING
      RETURNING id
    `;
    if (row) return { id: row.id, token: parts.token, expiresAt: params.expiresAt };
  }
  throw new Error("Failed to generate unique refresh token prefix");
};

export const create = async (params: {
  userId: string;
  client: OAuthClient;
  scopes: OAuthScope[];
  label?: string | null;
}): Promise<{ refreshToken: string; refreshTokenExpiresAt: string; familyId: string }> => {
  const expiresAt = nowPlusDays(REFRESH_TOKEN_LIFETIME_DAYS);

  return sql.begin(async (tx) => {
    const [family] = await tx<{ id: string }[]>`
      INSERT INTO oauth.refresh_token_families (
        client_id,
        user_id,
        scopes,
        audiences,
        label,
        expires_at
      )
      VALUES (
        ${params.client.clientId},
        ${params.userId}::uuid,
        ${toPgTextArray(params.scopes)}::text[],
        ${toPgTextArray(params.client.audiences)}::text[],
        ${params.label ?? null},
        ${expiresAt}
      )
      RETURNING id
    `;
    if (!family) throw new Error("Failed to create refresh token family");

    const token = await insertRefreshToken({
      db: tx,
      familyId: family.id,
      generation: 1,
      expiresAt,
    });

    return {
      familyId: family.id,
      refreshToken: token.token,
      refreshTokenExpiresAt: token.expiresAt.toISOString(),
    };
  });
};

const revokeFamily = async (familyId: string, reason: string): Promise<void> => {
  await sql`
    UPDATE oauth.refresh_token_families
    SET status = 'revoked',
      revoked_at = COALESCE(revoked_at, now()),
      revoked_reason = ${reason}
    WHERE id = ${familyId}::uuid
      AND status = 'active'
  `;
  await sql`
    UPDATE oauth.refresh_tokens
    SET status = 'revoked',
      revoked_at = COALESCE(revoked_at, now())
    WHERE family_id = ${familyId}::uuid
      AND status = 'active'
  `;
};

export const rotate = async (refreshToken: string, expectedClientId?: string): Promise<RefreshTokenRotationResult> => {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return { ok: false, error: "invalid_grant" };

  const rotated = await sql.begin(async (tx) => {
    const [row] = await tx<DbRefreshTokenGrant[]>`
      SELECT
        rt.id,
        rt.family_id,
        rt.secret_hash,
        rt.status,
        rt.generation,
        rt.expires_at,
        f.client_id,
        f.user_id,
        f.scopes,
        f.audiences,
        f.status AS family_status,
        f.expires_at AS family_expires_at
      FROM oauth.refresh_tokens rt
      JOIN oauth.refresh_token_families f ON f.id = rt.family_id
      WHERE rt.token_prefix = ${parsed.tokenPrefix}
      FOR UPDATE OF rt, f
    `;
    if (!row) return { ok: false as const, error: "invalid_grant" as const };

    const valid = await Bun.password.verify(parsed.secret, row.secret_hash);
    if (!valid) return { ok: false as const, error: "invalid_grant" as const };
    if (expectedClientId && row.client_id !== expectedClientId) return { ok: false as const, error: "invalid_grant" as const };

    if (row.status !== "active") {
      if (row.status === "rotated") {
        await tx`
          UPDATE oauth.refresh_tokens
          SET status = 'reused',
            used_at = COALESCE(used_at, now())
          WHERE id = ${row.id}::uuid
        `;
        await tx`
          UPDATE oauth.refresh_token_families
          SET status = 'revoked',
            revoked_at = COALESCE(revoked_at, now()),
            revoked_reason = 'refresh_token_reuse'
          WHERE id = ${row.family_id}::uuid
        `;
        await tx`
          UPDATE oauth.refresh_tokens
          SET status = 'revoked',
            revoked_at = COALESCE(revoked_at, now())
          WHERE family_id = ${row.family_id}::uuid
            AND status = 'active'
        `;
        return { ok: false as const, error: "reuse_detected" as const };
      }
      return { ok: false as const, error: "invalid_grant" as const };
    }

    if (row.family_status !== "active" || row.expires_at <= new Date() || row.family_expires_at <= new Date()) {
      return { ok: false as const, error: "invalid_grant" as const };
    }

    const next = await insertRefreshToken({
      db: tx,
      familyId: row.family_id,
      generation: row.generation + 1,
      previousTokenId: row.id,
      expiresAt: row.family_expires_at,
    });

    await tx`
      UPDATE oauth.refresh_tokens
      SET status = 'rotated',
        used_at = now(),
        rotated_at = now()
      WHERE id = ${row.id}::uuid
    `;
    await tx`
      UPDATE oauth.refresh_token_families
      SET last_used_at = now()
      WHERE id = ${row.family_id}::uuid
    `;

    return {
      ok: true as const,
      userId: row.user_id,
      clientId: row.client_id,
      scopes: row.scopes as OAuthScope[],
      audiences: row.audiences,
      refreshToken: next.token,
      refreshTokenExpiresAt: row.family_expires_at.toISOString(),
    };
  });

  if (!rotated.ok) return rotated;

  const client = await clients.getByClientId({ clientId: rotated.clientId });
  if (!client) {
    const familyId = await findFamilyId(refreshToken);
    if (familyId) await revokeFamily(familyId, "client_missing").catch(() => undefined);
    return { ok: false, error: "invalid_grant" };
  }

  return {
    ok: true,
    userId: rotated.userId,
    client,
    scopes: rotated.scopes,
    audiences: rotated.audiences,
    refreshToken: rotated.refreshToken,
    refreshTokenExpiresAt: rotated.refreshTokenExpiresAt,
  };
};

const findFamilyId = async (refreshToken: string): Promise<string | null> => {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return null;
  const [row] = await sql<{ family_id: string }[]>`
    SELECT family_id
    FROM oauth.refresh_tokens
    WHERE token_prefix = ${parsed.tokenPrefix}
  `;
  return row?.family_id ?? null;
};

export const revoke = async (refreshToken: string, clientId?: string): Promise<void> => {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return;

  const [row] = await sql<{ id: string; family_id: string; secret_hash: string; client_id: string }[]>`
    SELECT rt.id, rt.family_id, rt.secret_hash, f.client_id
    FROM oauth.refresh_tokens rt
    JOIN oauth.refresh_token_families f ON f.id = rt.family_id
    WHERE rt.token_prefix = ${parsed.tokenPrefix}
  `;
  if (!row) return;
  if (clientId && row.client_id !== clientId) return;

  const valid = await Bun.password.verify(parsed.secret, row.secret_hash);
  if (!valid) return;

  await revokeFamily(row.family_id, "revoked");
};
