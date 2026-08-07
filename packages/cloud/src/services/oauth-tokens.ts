import { sql } from "bun";
import * as jose from "jose";
import type { User } from "../contracts/shared";
import { publicCloudOrigin } from "../shared/app-url";
import { accounts } from "./accounts";
import { type ServiceAccount, serviceAccounts } from "./service-accounts";
import * as settings from "./settings";

type DbKey = {
  public_key: string;
  kid: string;
};

const SIGNING_KEY_GRACE_MS = 2 * 60 * 60 * 1_000;

const parseScopeClaim = (payload: jose.JWTPayload): string[] => {
  const value = payload.scope;
  if (typeof value !== "string") return [];
  return value
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
};

export type AuthenticatedOAuthToken =
  | {
      kind: "user";
      payload: jose.JWTPayload;
      user: User;
      scopes: string[];
    }
  | {
      kind: "service_account";
      payload: jose.JWTPayload;
      serviceAccount: ServiceAccount;
      delegatedUser: User | null;
      scopes: string[];
    };

const getIssuer = async (): Promise<string> => {
  const appUrl = await settings.get<string>("app.url");
  return publicCloudOrigin(appUrl);
};

const getVerificationKey = async (kid: string): Promise<CryptoKey | null> => {
  const graceCutoff = new Date(Date.now() - SIGNING_KEY_GRACE_MS);
  const [row] = await sql<DbKey[]>`
    SELECT public_key, kid
    FROM oauth.keys
    WHERE kid = ${kid}
      AND (retired_at IS NULL OR retired_at > ${graceCutoff})
  `;
  if (!row) return null;
  return jose.importSPKI(row.public_key, "RS256");
};

const getStringClaim = (payload: jose.JWTPayload, key: string): string | null => {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

export const verifyAccessToken = async (
  token: string,
  expectedAudience: string | string[] = "cloud",
): Promise<AuthenticatedOAuthToken | null> => {
  let kid: string | undefined;
  try {
    kid = jose.decodeProtectedHeader(token).kid;
  } catch {
    return null;
  }
  if (!kid) return null;
  const publicKey = await getVerificationKey(kid);
  if (!publicKey) return null;

  let payload: jose.JWTPayload;
  try {
    const result = await jose.jwtVerify(token, publicKey, {
      issuer: await getIssuer(),
      audience: expectedAudience,
    });
    payload = result.payload;
  } catch {
    return null;
  }

  if (payload.token_use !== "access") return null;

  const clientId = getStringClaim(payload, "client_id");
  if (!clientId) return null;
  const [client] = await sql<{ present: boolean }[]>`
    SELECT true AS present
    FROM oauth.clients
    WHERE client_id = ${clientId}
  `;
  if (!client) return null;

  const serviceAccountId = getStringClaim(payload, "service_account_id");
  if (serviceAccountId) {
    const serviceAccount = await serviceAccounts.get({ id: serviceAccountId });
    if (!serviceAccount || serviceAccount.status !== "active") return null;

    const delegatedUser = serviceAccount.delegatedUserId ? await accounts.users.get({ id: serviceAccount.delegatedUserId }) : null;
    if (serviceAccount.kind === "user_delegated" && !delegatedUser) return null;

    return {
      kind: "service_account",
      payload,
      serviceAccount,
      delegatedUser,
      scopes: parseScopeClaim(payload),
    };
  }

  const userId = getStringClaim(payload, "id");
  const uid = getStringClaim(payload, "uid") ?? (typeof payload.sub === "string" ? payload.sub : null);
  const user = userId ? await accounts.users.get({ id: userId }) : uid ? await accounts.users.get({ uid }) : null;
  if (!user) return null;

  return {
    kind: "user",
    payload,
    user,
    scopes: parseScopeClaim(payload),
  };
};

export const oauthTokens = {
  verifyAccessToken,
};
