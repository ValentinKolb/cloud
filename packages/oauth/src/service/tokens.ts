import { sql } from "bun";
import * as jose from "jose";
import type { OAuthClient, OAuthScope } from "@/contracts";
import { accounts, serviceAccounts } from "@valentinkolb/cloud/services";

// ==========================
// OAuth Tokens Service (JWT with jose)
// ==========================

type DbKey = {
  id: string;
  private_key: string;
  public_key: string;
  kid: string;
  created_at: Date;
};

type KeyPair = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  kid: string;
};

let cachedKeyPair: KeyPair | null = null;

export class InvalidOAuthScopeError extends Error {
  constructor() {
    super("Requested scope is not allowed for this client");
  }
}

export class InvalidOAuthServiceAccountError extends Error {
  constructor() {
    super("Client is not bound to an active resource service account");
  }
}

export class InvalidOAuthResourceError extends Error {
  constructor() {
    super("Requested resource is not allowed for this client");
  }
}

const dedupe = (values: string[]): string[] => Array.from(new Set(values.filter((value) => value.length > 0)));

const parseScopes = (scope: string | undefined): string[] =>
  scope
    ?.split(" ")
    .map((value) => value.trim())
    .filter((value) => value.length > 0) ?? [];

const resolveRequestedScopes = (client: OAuthClient, requestedScope?: string): OAuthScope[] => {
  const requested = parseScopes(requestedScope);
  if (requested.length === 0) return client.scopes;

  const allowed = new Set(client.scopes);
  if (requested.some((scope) => !allowed.has(scope as OAuthScope))) {
    throw new InvalidOAuthScopeError();
  }
  return requested as OAuthScope[];
};

const getAccessTokenAudience = (client: OAuthClient, resources: string[] = []): string[] =>
  dedupe(["cloud", client.clientId, ...client.audiences, ...resources]);

const validateRequestedResource = (client: OAuthClient, resource: string | undefined): string[] => {
  if (!resource) return [];
  const allowed = new Set(getAccessTokenAudience(client));
  if (!allowed.has(resource)) {
    throw new InvalidOAuthResourceError();
  }
  return [resource];
};

/**
 * Get or create RSA key pair for JWT signing
 */
export const getOrCreateKeyPair = async (): Promise<KeyPair> => {
  if (cachedKeyPair) return cachedKeyPair;

  // Try to load from database
  const [row] = await sql<DbKey[]>`
    SELECT id, private_key, public_key, kid, created_at
    FROM oauth.keys
    WHERE id = 'current'
  `;

  if (row) {
    const privateKey = await jose.importPKCS8(row.private_key, "RS256");
    const publicKey = await jose.importSPKI(row.public_key, "RS256");
    cachedKeyPair = { privateKey, publicKey, kid: row.kid };
    return cachedKeyPair;
  }

  // Generate new key pair (extractable: true is required to export to PEM)
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256", {
    modulusLength: 2048,
    extractable: true,
  });

  const privateKeyPem = await jose.exportPKCS8(privateKey);
  const publicKeyPem = await jose.exportSPKI(publicKey);
  const kid = crypto.randomUUID();

  await sql`
    INSERT INTO oauth.keys (id, private_key, public_key, kid)
    VALUES ('current', ${privateKeyPem}, ${publicKeyPem}, ${kid})
    ON CONFLICT (id) DO UPDATE SET
      private_key = ${privateKeyPem},
      public_key = ${publicKeyPem},
      kid = ${kid},
      created_at = now()
  `;

  cachedKeyPair = { privateKey, publicKey, kid };
  return cachedKeyPair;
};

/**
 * Get JWKS (JSON Web Key Set) for public key distribution
 */
export const getJwks = async (): Promise<jose.JSONWebKeySet> => {
  const { publicKey, kid } = await getOrCreateKeyPair();
  const jwk = await jose.exportJWK(publicKey);

  return {
    keys: [
      {
        ...jwk,
        kid,
        use: "sig",
        alg: "RS256",
      },
    ],
  };
};

/**
 * Get OpenID Connect discovery configuration
 */
export const getOpenIdConfiguration = (issuer: string) => ({
  issuer,
  authorization_endpoint: `${issuer}/oauth/authorize`,
  token_endpoint: `${issuer}/oauth/token`,
  userinfo_endpoint: `${issuer}/oauth/userinfo`,
  end_session_endpoint: `${issuer}/oauth/logout`,
  jwks_uri: `${issuer}/.well-known/jwks.json`,
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  scopes_supported: ["openid", "profile", "email", "groups", "read", "write", "admin"],
  token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
  claims_supported: [
    "sub",
    "uid",
    "id",
    "iss",
    "aud",
    "exp",
    "iat",
    "name",
    "display_name",
    "given_name",
    "family_name",
    "email",
    "nonce",
    "groups",
    "token_use",
    "principal_type",
    "client_id",
    "azp",
    "scope",
    "service_account_id",
    "service_account_kind",
    "app_id",
    "resource_type",
    "resource_id",
  ],
  code_challenge_methods_supported: ["S256", "plain"],
  grant_types_supported: ["authorization_code", "client_credentials"],
  resource_parameter_supported: true,
});

/**
 * Create access token and optionally id_token
 */
export const createTokens = async (params: {
  userId: string;
  client: OAuthClient;
  issuer: string;
  nonce?: string | null;
}): Promise<{ accessToken: string; idToken: string | null; expiresIn: number }> => {
  const { userId, client, issuer, nonce } = params;
  const { privateKey, kid } = await getOrCreateKeyPair();

  // Load user to get uid for sub claim
  const user = await accounts.users.get({ id: userId });
  if (!user) {
    throw new Error("User not found");
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600; // 1 hour

  // Use uid as subject (not internal UUID)
  const subject = user.uid;

  // Access Token
  const accessToken = await new jose.SignJWT({
    token_use: "access",
    principal_type: "user",
    uid: user.uid,
    id: user.id,
    client_id: client.clientId,
    azp: client.clientId,
    scope: client.scopes.join(" "),
  })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(getAccessTokenAudience(client))
    .setIssuedAt(now)
    .setExpirationTime(now + expiresIn)
    .setJti(crypto.randomUUID())
    .sign(privateKey);

  // ID Token (only if openid scope)
  let idToken: string | null = null;
  if (client.scopes.includes("openid")) {
    const idTokenClaims: Record<string, unknown> = {
      uid: user.uid,
      id: user.id,
    };

    if (nonce !== undefined && nonce !== null) {
      idTokenClaims.nonce = nonce;
    }

    if (client.scopes.includes("profile")) {
      idTokenClaims.name = user.displayName;
      idTokenClaims.display_name = user.displayName;
      idTokenClaims.given_name = user.givenname;
      idTokenClaims.family_name = user.sn;
    }

    if (client.scopes.includes("email")) {
      idTokenClaims.email = user.mail;
    }

    if (client.scopes.includes("groups")) {
      const groups = await accounts.users.getGroups({ id: userId, recursive: true });
      idTokenClaims.groups = groups;
    }

    idToken = await new jose.SignJWT(idTokenClaims)
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(issuer)
      .setSubject(subject)
      .setAudience(client.clientId)
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .sign(privateKey);
  }

  return { accessToken, idToken, expiresIn };
};

/**
 * Create a client-credentials access token for a resource-bound service account.
 */
export const createClientCredentialsToken = async (params: {
  client: OAuthClient;
  issuer: string;
  scope?: string;
  resource?: string;
}): Promise<{ accessToken: string; expiresIn: number; scope: string }> => {
  const { client, issuer, scope, resource } = params;
  const { privateKey, kid } = await getOrCreateKeyPair();

  if (!client.serviceAccountId) {
    throw new InvalidOAuthServiceAccountError();
  }

  const serviceAccount = await serviceAccounts.get({ id: client.serviceAccountId });
  if (!serviceAccount || serviceAccount.status !== "active" || serviceAccount.kind !== "resource_bound") {
    throw new InvalidOAuthServiceAccountError();
  }

  const requestedScopes = resolveRequestedScopes(client, scope);
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600;
  const scopeValue = requestedScopes.join(" ");
  const resourceAudiences = validateRequestedResource(client, resource);

  const accessToken = await new jose.SignJWT({
    token_use: "access",
    principal_type: "service_account",
    service_account_id: serviceAccount.id,
    service_account_kind: serviceAccount.kind,
    app_id: serviceAccount.appId,
    resource_type: serviceAccount.resourceType,
    resource_id: serviceAccount.resourceId,
    client_id: client.clientId,
    azp: client.clientId,
    scope: scopeValue,
  })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(issuer)
    .setSubject(serviceAccount.id)
    .setAudience(getAccessTokenAudience(client, resourceAudiences))
    .setIssuedAt(now)
    .setExpirationTime(now + expiresIn)
    .setJti(crypto.randomUUID())
    .sign(privateKey);

  return { accessToken, expiresIn, scope: scopeValue };
};

/**
 * Verify access token and return claims
 */
export const verifyAccessToken = async (params: { token: string; issuer: string }): Promise<jose.JWTPayload | null> => {
  try {
    const { publicKey } = await getOrCreateKeyPair();
    const { payload } = await jose.jwtVerify(params.token, publicKey, {
      issuer: params.issuer,
    });
    return payload;
  } catch {
    return null;
  }
};

/**
 * Create userinfo response based on scopes
 * @param sub - The subject (uid) from the access token
 */
export const createUserInfo = async (params: { sub: string; scopes: OAuthScope[] }): Promise<Record<string, unknown> | null> => {
  const { sub, scopes } = params;

  // sub is the uid, load user by uid
  const user = await accounts.users.get({ uid: sub });
  if (!user) return null;

  const userInfo: Record<string, unknown> = {
    sub: user.uid,
    uid: user.uid,
    id: user.id,
  };

  if (scopes.includes("profile")) {
    userInfo.name = user.displayName;
    userInfo.display_name = user.displayName;
    userInfo.given_name = user.givenname;
    userInfo.family_name = user.sn;
  }

  if (scopes.includes("email")) {
    userInfo.email = user.mail;
  }

  if (scopes.includes("groups")) {
    const groups = await accounts.users.getGroups({ id: user.id, recursive: true });
    userInfo.groups = groups;
  }

  return userInfo;
};
