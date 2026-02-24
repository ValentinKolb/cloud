import { sql } from "bun";
import type {
  MutationResult,
  OAuthClient,
  OAuthClientWithSecret,
  CreateOAuthClient,
  UpdateOAuthClient,
  UserRealm,
  OAuthScope,
} from "@/oauth/contracts";

// ==========================
// OAuth Clients Service
// ==========================

type DbClient = {
  id: string;
  name: string;
  description: string | null;
  client_id: string;
  client_secret_hash: string | null;
  redirect_uris: string[];
  logout_uri: string | null;
  scopes: string[];
  allowed_roles: string[];
  is_public: boolean;
  created_at: Date;
  created_by: string | null;
};

/**
 * Maps an OAuth client row to the API-facing client object.
 */
const mapToClient = (row: DbClient): OAuthClient => ({
  id: row.id,
  name: row.name,
  description: row.description,
  clientId: row.client_id,
  redirectUris: row.redirect_uris,
  logoutUri: row.logout_uri,
  scopes: row.scopes as OAuthScope[],
  allowedRoles: row.allowed_roles as UserRealm[],
  isPublic: row.is_public,
  createdAt: row.created_at.toISOString(),
  createdBy: row.created_by,
});

/**
 * List all OAuth clients
 */
export const list = async (): Promise<OAuthClient[]> => {
  const rows = await sql<DbClient[]>`
    SELECT id, name, description, client_id, redirect_uris, logout_uri, scopes, allowed_roles, is_public, created_at, created_by
    FROM oauth.clients
    ORDER BY created_at DESC
  `;
  return rows.map(mapToClient);
};

/**
 * Get client by internal ID
 */
export const get = async (params: { id: string }): Promise<OAuthClient | null> => {
  const [row] = await sql<DbClient[]>`
    SELECT id, name, description, client_id, redirect_uris, logout_uri, scopes, allowed_roles, is_public, created_at, created_by
    FROM oauth.clients
    WHERE id = ${params.id}
  `;
  return row ? mapToClient(row) : null;
};

/**
 * Get client by client_id (OAuth identifier)
 */
export const getByClientId = async (params: { clientId: string }): Promise<OAuthClient | null> => {
  const [row] = await sql<DbClient[]>`
    SELECT id, name, description, client_id, redirect_uris, logout_uri, scopes, allowed_roles, is_public, created_at, created_by
    FROM oauth.clients
    WHERE client_id = ${params.clientId}
  `;
  return row ? mapToClient(row) : null;
};

/**
 * Create a new OAuth client
 */
export const create = async (params: { data: CreateOAuthClient; createdBy: string }): Promise<MutationResult<OAuthClientWithSecret>> => {
  const { data, createdBy } = params;

  // Generate client secret for confidential clients
  const clientSecret = data.isPublic ? null : crypto.randomUUID() + crypto.randomUUID();
  const clientSecretHash = clientSecret ? await Bun.password.hash(clientSecret) : null;

  // Format arrays as PostgreSQL array literals: {value1,value2}
  const redirectUrisLiteral = `{${data.redirectUris.join(",")}}`;
  const scopesLiteral = `{${data.scopes.join(",")}}`;
  const allowedRolesLiteral = `{${data.allowedRoles.join(",")}}`;

  const [row] = await sql<DbClient[]>`
    INSERT INTO oauth.clients (name, description, redirect_uris, logout_uri, scopes, allowed_roles, is_public, client_secret_hash, created_by)
    VALUES (
      ${data.name},
      ${data.description ?? null},
      ${redirectUrisLiteral}::text[],
      ${data.logoutUri ?? null},
      ${scopesLiteral}::text[],
      ${allowedRolesLiteral}::text[],
      ${data.isPublic},
      ${clientSecretHash},
      ${createdBy}
    )
    RETURNING id, name, description, client_id, redirect_uris, logout_uri, scopes, allowed_roles, is_public, created_at, created_by
  `;

  if (!row) {
    return { ok: false, error: "Failed to create client", status: 500 };
  }

  return {
    ok: true,
    data: {
      ...mapToClient(row),
      clientSecret: clientSecret ?? "",
    },
  };
};

/**
 * Update an OAuth client
 */
export const update = async (params: { id: string; data: UpdateOAuthClient }): Promise<MutationResult<void>> => {
  const { id, data } = params;

  const existing = await get({ id });
  if (!existing) {
    return { ok: false, error: "Client not found", status: 404 };
  }

  // Format arrays as PostgreSQL array literals
  const redirectUrisLiteral = `{${(data.redirectUris ?? existing.redirectUris).join(",")}}`;
  const scopesLiteral = `{${(data.scopes ?? existing.scopes).join(",")}}`;
  const allowedRolesLiteral = `{${(data.allowedRoles ?? existing.allowedRoles).join(",")}}`;

  // Handle description: undefined means keep existing, null means clear it
  const description = data.description === undefined ? existing.description : data.description;
  // Handle logoutUri: undefined means keep existing, null means clear it
  const logoutUri = data.logoutUri === undefined ? existing.logoutUri : data.logoutUri;

  await sql`
    UPDATE oauth.clients
    SET
      name = ${data.name ?? existing.name},
      description = ${description},
      redirect_uris = ${redirectUrisLiteral}::text[],
      logout_uri = ${logoutUri},
      scopes = ${scopesLiteral}::text[],
      allowed_roles = ${allowedRolesLiteral}::text[]
    WHERE id = ${id}
  `;

  return { ok: true, data: undefined };
};

/**
 * Delete an OAuth client
 */
export const delete_ = async (params: { id: string }): Promise<MutationResult<void>> => {
  const result = await sql`
    DELETE FROM oauth.clients
    WHERE id = ${params.id}
  `;

  if (result.count === 0) {
    return { ok: false, error: "Client not found", status: 404 };
  }

  return { ok: true, data: undefined };
};

/**
 * Regenerate client secret (confidential clients only)
 */
export const regenerateSecret = async (params: { id: string }): Promise<MutationResult<{ clientSecret: string }>> => {
  const existing = await get({ id: params.id });
  if (!existing) {
    return { ok: false, error: "Client not found", status: 404 };
  }

  if (existing.isPublic) {
    return { ok: false, error: "Cannot regenerate secret for public clients", status: 400 };
  }

  const clientSecret = crypto.randomUUID() + crypto.randomUUID();
  const clientSecretHash = await Bun.password.hash(clientSecret);

  await sql`
    UPDATE oauth.clients
    SET client_secret_hash = ${clientSecretHash}
    WHERE id = ${params.id}
  `;

  return { ok: true, data: { clientSecret } };
};

/**
 * Validate client credentials and return client if valid
 */
export const validateCredentials = async (params: { clientId: string; clientSecret?: string }): Promise<OAuthClient | null> => {
  const [row] = await sql<(DbClient & { client_secret_hash: string | null })[]>`
    SELECT id, name, description, client_id, client_secret_hash, redirect_uris, logout_uri, scopes, allowed_roles, is_public, created_at, created_by
    FROM oauth.clients
    WHERE client_id = ${params.clientId}
  `;

  if (!row) return null;

  // Public clients don't need secret validation
  if (row.is_public) {
    return mapToClient(row);
  }

  // Confidential clients require valid secret
  if (!params.clientSecret || !row.client_secret_hash) {
    return null;
  }

  const valid = await Bun.password.verify(params.clientSecret, row.client_secret_hash);
  return valid ? mapToClient(row) : null;
};

/**
 * Validate that a redirect URI is allowed for this client
 */
export const validateRedirectUri = (client: OAuthClient, redirectUri: string): boolean => {
  return client.redirectUris.includes(redirectUri);
};

/**
 * Check if a user role is allowed for this client
 */
export const isRoleAllowed = (client: OAuthClient, realm: UserRealm): boolean => {
  return client.allowedRoles.includes(realm);
};
