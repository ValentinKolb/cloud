export const providerErrorCode = (error: unknown, fallback: string): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code) ? code : fallback;
};

export const providerErrorMessage = (error: unknown, fallback: string): string =>
  (error instanceof Error ? error.message : fallback).slice(0, 1_000);

export const isProviderAuthenticationFailure = (error: unknown, code = providerErrorCode(error, "")): boolean => {
  const value = error as { authenticationFailed?: unknown; responseCode?: unknown } | null;
  return (
    value?.authenticationFailed === true ||
    code === "EAUTH" ||
    code === "CREDENTIAL_EXPIRED" ||
    code.includes("AUTHENTICATION") ||
    code.includes("AUTH_FAILED")
  );
};

const CONCURRENT_CREDENTIAL_REFRESH_CODES = new Set(["CREDENTIAL_REFRESH_BUSY", "CREDENTIAL_REFRESH_SUPERSEDED"]);

export const isConcurrentCredentialRefresh = (error: unknown): boolean =>
  CONCURRENT_CREDENTIAL_REFRESH_CODES.has(providerErrorCode(error, ""));
