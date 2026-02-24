import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { proxyAuthService } from "./service";

/**
 * Traefik ForwardAuth verify endpoint.
 *
 * Traefik sends a GET request with X-Forwarded-* headers.
 * - 200 + user headers = authenticated, request proceeds to upstream
 * - 302 = not authenticated, redirect to login
 * - 403 = authenticated but not authorized for this client
 */
const app = new Hono<AuthContext>().get("/verify/:clientId", auth.requireRole("*"), async (c) => {
  const user = c.get("user");
  const clientId = c.req.param("clientId");

  // Build original URL from Traefik headers when available.
  // Fallback to the current request URL for direct/local testing.
  const forwardedProto = c.req.header("X-Forwarded-Proto") ?? "https";
  const forwardedHost = c.req.header("X-Forwarded-Host");
  const forwardedUri = c.req.header("X-Forwarded-Uri") ?? "/";

  const originalUrl = (() => {
    if (!forwardedHost) return c.req.url;
    const path = forwardedUri.startsWith("/") ? forwardedUri : `/${forwardedUri}`;
    try {
      return new URL(path, `${forwardedProto}://${forwardedHost}`).toString();
    } catch {
      return c.req.url;
    }
  })();

  // Not logged in → redirect to login with return URL
  if (!user) {
    const loginUrl = `/auth/login?redirectTo=${encodeURIComponent(originalUrl)}`;
    return c.redirect(loginUrl, 302);
  }

  // Look up proxy client
  const client = await proxyAuthService.client.getByClientId({ clientId });
  if (!client) {
    return c.text("Unknown proxy auth client", 404);
  }

  // Check if user is member of any allowed group
  const userGroups = new Set(user.memberofGroup);
  const hasAccess = client.allowedGroups.some((g) => userGroups.has(g));

  if (!hasAccess) {
    return c.text("Access denied: you are not a member of an authorized group.", 403);
  }

  // Authenticated + authorized → 200 with user info headers
  c.header("X-Forwarded-User", user.uid);
  c.header("X-Forwarded-Email", user.mail ?? "");
  c.header("X-Forwarded-Groups", user.memberofGroup.join(","));
  return c.text("OK", 200);
});

export default app;
