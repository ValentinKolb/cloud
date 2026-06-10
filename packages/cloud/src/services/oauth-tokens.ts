import { sql } from "bun";
import * as jose from "jose";
import { accounts } from "./accounts";
import * as settings from "./settings";
import { serviceAccounts, type ServiceAccount } from "./service-accounts";
import type { User } from "../contracts/shared";

type DbKey = {
  public_key: string;
  kid: string;
};

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
  return appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
};

const getCurrentPublicKey = async (): Promise<CryptoKey | null> => {
  const [row] = await sql<DbKey[]>`
    SELECT public_key, kid
    FROM oauth.keys
    WHERE id = 'current'
  `;
  if (!row) return null;
  return jose.importSPKI(row.public_key, "RS256");
};

const getStringClaim = (payload: jose.JWTPayload, key: string): string | null => {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

export const verifyAccessToken = async (token: string): Promise<AuthenticatedOAuthToken | null> => {
  const publicKey = await getCurrentPublicKey();
  if (!publicKey) return null;

  let payload: jose.JWTPayload;
  try {
    const result = await jose.jwtVerify(token, publicKey, {
      issuer: await getIssuer(),
      audience: "cloud",
    });
    payload = result.payload;
  } catch {
    return null;
  }

  if (payload.token_use !== "access") return null;

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
  };
};

export const oauthTokens = {
  verifyAccessToken,
};
