import { app } from "../config";
import type { MailOAuthProvider, MailOAuthProviderId } from "../contracts";

export type OAuthProviderDeclaration = MailOAuthProvider & {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
  scopes: readonly string[];
  clientIdSetting: "mail.oauth.google_client_id" | "mail.oauth.microsoft_client_id";
  clientSecretSetting: "mail.oauth.google_client_secret" | "mail.oauth.microsoft_client_secret";
  authorizationParameters: Readonly<Record<string, string>>;
};

export const OAUTH_PROVIDER_DECLARATIONS: Readonly<Record<MailOAuthProviderId, OAuthProviderDeclaration>> = {
  google: {
    id: "google",
    name: "Google",
    domains: ["gmail.com", "googlemail.com"],
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    revocationEndpoint: "https://oauth2.googleapis.com/revoke",
    scopes: ["https://mail.google.com/"],
    clientIdSetting: "mail.oauth.google_client_id",
    clientSecretSetting: "mail.oauth.google_client_secret",
    authorizationParameters: { access_type: "offline", prompt: "consent" },
  },
  microsoft: {
    id: "microsoft",
    name: "Microsoft",
    domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"],
    authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    revocationEndpoint: null,
    scopes: ["offline_access", "https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"],
    clientIdSetting: "mail.oauth.microsoft_client_id",
    clientSecretSetting: "mail.oauth.microsoft_client_secret",
    authorizationParameters: {},
  },
};

export type ConfiguredOAuthProvider = {
  declaration: OAuthProviderDeclaration;
  clientId: string;
  clientSecret: string | null;
};

export const getConfiguredOAuthProvider = async (id: MailOAuthProviderId): Promise<ConfiguredOAuthProvider | null> => {
  const declaration = OAUTH_PROVIDER_DECLARATIONS[id];
  const clientId = (await app.settings.get(declaration.clientIdSetting)).trim();
  if (!clientId) return null;
  const clientSecret = (await app.settings.get(declaration.clientSecretSetting)).trim();
  return { declaration, clientId, clientSecret: clientSecret || null };
};

export const listConfiguredOAuthProviders = async (): Promise<MailOAuthProvider[]> => {
  const providers = await Promise.all(
    Object.values(OAUTH_PROVIDER_DECLARATIONS).map(async (declaration) =>
      (await getConfiguredOAuthProvider(declaration.id))
        ? { id: declaration.id, name: declaration.name, domains: [...declaration.domains] }
        : null,
    ),
  );
  return providers.filter((provider): provider is MailOAuthProvider => provider !== null);
};

export const configuredOAuthProviderForEmail = async (email: string): Promise<MailOAuthProviderId | null> => {
  const domain = email.trim().toLowerCase().split("@").at(-1) ?? "";
  for (const declaration of Object.values(OAUTH_PROVIDER_DECLARATIONS)) {
    if (declaration.domains.includes(domain) && (await getConfiguredOAuthProvider(declaration.id))) return declaration.id;
  }
  return null;
};
