import { normalizeRedirectTo } from "@valentinkolb/cloud/shared";

/** Resolve where an already-authenticated visitor should leave the login page. */
export const resolveAuthenticatedLoginRedirect = (requestUrl: string): string => {
  const request = new URL(requestUrl);

  // A signed-in session must not implicitly consume or bypass a magic-link token.
  if (request.searchParams.has("token")) return "/";

  const redirectTo = normalizeRedirectTo(request.searchParams.get("redirectTo"));
  if (!redirectTo) return "/";

  // Avoid redirecting the login guard back into itself.
  if (new URL(redirectTo, request.origin).pathname === "/auth/login") return "/";

  return redirectTo;
};
