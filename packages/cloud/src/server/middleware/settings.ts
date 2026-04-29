/**
 * Per-request middleware that exposes a frozen settings snapshot on
 * `c.get("settings")`. Backed by Redis cache-aside (5-minute TTL),
 * so the per-request cost is a single Redis read at most.
 *
 * Required by anything that reads typed settings inside an HTTP
 * handler via `c.get("settings").<key>`.
 *
 * `skipPrefixes` defaults to `["/public/", "/_ssr/", "/branding/", "/favicon"]`
 * — those paths never read settings, so skipping the snapshot load
 * keeps static-asset requests free. Apps that mount settings only on
 * /api or /app can avoid the option entirely by scoping the
 * `.use()` path instead.
 */
import { createMiddleware } from "hono/factory";
import { loadSnapshot } from "../../services/settings/snapshot";

const DEFAULT_SKIP = ["/public/", "/_ssr/", "/branding/", "/favicon"] as const;

export const settings = (opts?: { skipPrefixes?: readonly string[] }) => {
  const skip = opts?.skipPrefixes ?? DEFAULT_SKIP;
  return createMiddleware(async (c, next) => {
    const path = c.req.path;
    if (!skip.some((p) => path.startsWith(p))) {
      (c as unknown as { set: (k: string, v: unknown) => void }).set("settings", await loadSnapshot());
    }
    await next();
  });
};
