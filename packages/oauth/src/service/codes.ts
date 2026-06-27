import { toPgTextArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import type { OAuthClient, OAuthScope } from "@/contracts";
import * as clients from "./clients";

// ==========================
// OAuth Authorization Codes Service
// ==========================

type DbCode = {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scopes: string[];
  nonce: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
  expires_at: Date;
  used: boolean;
};

const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/**
 * Create an authorization code
 */
export const create = async (params: {
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: OAuthScope[];
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: "S256" | "plain";
}): Promise<string> => {
  const { clientId, userId, redirectUri, scopes, nonce, codeChallenge, codeChallengeMethod } = params;

  const [row] = await sql<{ code: string }[]>`
    INSERT INTO oauth.codes (client_id, user_id, redirect_uri, scopes, nonce, code_challenge, code_challenge_method)
    VALUES (
      ${clientId},
      ${userId},
      ${redirectUri},
      ${toPgTextArray(scopes)}::text[],
      ${nonce ?? null},
      ${codeChallenge ?? null},
      ${codeChallengeMethod ?? null}
    )
    RETURNING code
  `;

  return row!.code;
};

/**
 * Consume (use) an authorization code and return user/client info
 * Returns null if code is invalid, expired, already used, or PKCE validation fails
 */
export const consume = async (params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<{ userId: string; client: OAuthClient; scopes: OAuthScope[]; nonce: string | null } | null> => {
  const { code, clientId, redirectUri, codeVerifier } = params;

  // Get and validate code
  const [row] = await sql<DbCode[]>`
    SELECT code, client_id, user_id, redirect_uri, scopes, nonce, code_challenge, code_challenge_method, expires_at, used
    FROM oauth.codes
    WHERE code = ${code}
  `;

  if (!row) return null;

  // Check if already used
  if (row.used) return null;

  // Check expiration
  if (row.expires_at < new Date()) return null;

  // Validate client_id matches
  if (row.client_id !== clientId) return null;

  // Validate redirect_uri matches
  if (row.redirect_uri !== redirectUri) return null;

  // PKCE validation
  if (row.code_challenge) {
    if (!codeVerifier || !PKCE_VERIFIER_PATTERN.test(codeVerifier)) return null;

    let computedChallenge: string;
    if (row.code_challenge_method === "S256") {
      // SHA256 hash of verifier, base64url encoded
      const encoder = new TextEncoder();
      const data = encoder.encode(codeVerifier);
      const hash = await crypto.subtle.digest("SHA-256", data);
      computedChallenge = base64UrlEncode(new Uint8Array(hash));
    } else {
      // plain method
      computedChallenge = codeVerifier;
    }

    if (computedChallenge !== row.code_challenge) return null;
  }

  // Mark as used atomically so concurrent token exchanges cannot consume the same code twice.
  const [usedRow] = await sql<{ code: string }[]>`
    UPDATE oauth.codes
    SET used = true
    WHERE code = ${code} AND used = false
    RETURNING code
  `;
  if (!usedRow) return null;

  // Get client
  const client = await clients.getByClientId({ clientId });
  if (!client) return null;

  return { userId: row.user_id, client, scopes: row.scopes as OAuthScope[], nonce: row.nonce };
};

/**
 * Cleanup expired and used codes
 */
export const cleanup = async (): Promise<number> => {
  const result = await sql`
    DELETE FROM oauth.codes
    WHERE expires_at < now() OR used = true
  `;
  return result.count;
};

// ==========================
// Helpers
// ==========================

/**
 * Encodes bytes into base64url format required by PKCE challenge checks.
 */
function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
