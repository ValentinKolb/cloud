import { Hono } from "hono";
import { join } from "node:path";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import { coreSettings } from "@valentinkolb/cloud/services";
import profilePage from "./me/page";
import notFoundPage from "./NotFound";
import loginPage from "./auth/page";
import newPasswordPage from "./auth/new-password/page";
import homePage from "./home/page";
import adminPage from "./admin/page";

/**
 * Creates the SSR pages router.
 * App pages are served by individual containers (microservices mode).
 */
export const createPagesRouter = (
  options?: { brandingPublicDir?: string },
): Hono<AuthContext> => {
  const brandingPublicDir = options?.brandingPublicDir ?? "public";
  const pages = new Hono<AuthContext>()
    // Prevent browser from caching SSR pages (user state changes on login/logout)
    // Skip for branding assets — they set their own cache headers
    .use("*", async (c, next) => {
      await next();
      if (c.req.path.startsWith("/branding/")) return;
      c.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      c.header("Pragma", "no-cache");
      c.header("Expires", "0");
    })
    // Home page (requires login)
    .get("/", auth.requireRole("authenticated", auth.redirectToLogin), ...homePage)
    // Profile
    .get("/me", auth.requireRole("authenticated", auth.redirectToLogin), ...profilePage)
    // Admin pages (admin only)
    .get("/admin", auth.requireRole("admin", auth.redirectToLogin), ...adminPage)
    // /admin/apps was merged into the gateway admin page.
    .get("/admin/apps", auth.requireRole("admin", auth.redirectToLogin), (c) => c.redirect("/admin/gateway", 302))
    .get("/admin/sync", auth.requireRole("admin", auth.redirectToLogin), (c) => c.redirect("/app/accounts#sync-activity", 302))
    // Auth routes
    .get("/auth/login", auth.requireRole("anonymous", auth.redirect("/")), ...loginPage)
    .get("/auth/new-password", ...newPasswordPage)
    .get("/auth/extend", auth.requireRole("authenticated", auth.redirectToLogin), async (c) => {
      return c.redirect("/me?action=extend", 302);
    })
    // Legal pages (Imprint / Privacy / Terms) live in the settings app — see
    // packages/settings/src/index.ts and the `legal.*` settings group.
    // Branding assets (public, no auth, cached)
    .get("/branding/logo", async (c) => {
      return serveBranding(c, "app.logo", join(brandingPublicDir, "logo.svg"), "image/svg+xml");
    })
    .get("/branding/favicon", async (c) => {
      // Default favicon = same SVG as the logo. User-uploaded favicons come
      // through as data URIs and override this fallback (mime taken from the
      // data URI, so PNG/ICO uploads still work).
      return serveBranding(c, "app.favicon", join(brandingPublicDir, "logo.svg"), "image/svg+xml");
    });

  // 404 catch-all (must be after all mounted routes)
  pages.get("/*", auth.requireRole("*"), ...notFoundPage);
  return pages;
};

/** Serve a branding asset from settings (base64 data URI) or fall back to a static file. */
async function serveBranding(c: import("hono").Context, settingKey: string, fallbackPath: string, fallbackMime: string): Promise<Response> {
  const dataUri = await coreSettings.get<string>(settingKey);

  if (dataUri) {
    // Parse data URI: data:<mime>;base64,<data>
    const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const mime = match[1]!;
      const binary = Buffer.from(match[2]!, "base64");
      c.header("Content-Type", mime);
      c.header("Cache-Control", "public, max-age=3600");
      return c.body(binary);
    }
  }

  // Fallback: serve static file
  const file = Bun.file(fallbackPath);
  if (await file.exists()) {
    c.header("Content-Type", fallbackMime);
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(await file.arrayBuffer());
  }

  return c.notFound();
}
