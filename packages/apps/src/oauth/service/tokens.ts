import { sql } from "bun";
import * as jose from "jose";
import type { OAuthClient, OAuthScope } from "@/oauth/contracts";
import { accounts } from "@valentinkolb/cloud/core/services";

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
  scopes_supported: ["openid", "profile", "email", "groups"],
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
    "groups",
  ],
  code_challenge_methods_supported: ["S256", "plain"],
  grant_types_supported: ["authorization_code"],
});

/**
 * Create access token and optionally id_token
 */
export const createTokens = async (params: {
  userId: string;
  client: OAuthClient;
  issuer: string;
}): Promise<{ accessToken: string; idToken: string | null; expiresIn: number }> => {
  const { userId, client, issuer } = params;
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
    scope: client.scopes.join(" "),
  })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(client.clientId)
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
