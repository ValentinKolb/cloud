import { Hono } from "hono";
import { join } from "node:path";
import { auth, type AuthContext } from "@valentinkolb/cloud-lib/server/middleware/auth";
import { getSync } from "@valentinkolb/cloud-core/services/settings";
import notFoundPage from "@/pages/NotFound";
import loginPage from "@/pages/auth/page";
import newPasswordPage from "@/pages/auth/new-password/page";
import { createProfilePage, type AccountsService } from "@/pages/me/page";
import { createHomePage } from "@/pages/home/page";
import adminPage from "@/pages/admin/page";
import datenschutzPage from "@/pages/legal/datenschutz";
import type { AppFacade } from "@valentinkolb/cloud-contracts/app";

type CreatePagesRouterOptions = {
  brandingPublicDir?: string;
};

/**
 * Creates the SSR pages router and mounts all app page routes.
 */
export const createPagesRouter = (
  apps: readonly AppFacade[],
  options?: CreatePagesRouterOptions,
): Hono<AuthContext> => {
  const brandingPublicDir = options?.brandingPublicDir ?? "public";
  const homePage = createHomePage(apps);
  const accountsService = (apps.find((app) => app.meta.id === "accounts")?.service as AccountsService | undefined) ?? null;
  const profilePage = createProfilePage(accountsService);

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
    // Auth routes
    .get("/auth/login", auth.requireRole("anonymous", auth.redirect("/")), ...loginPage)
    .get("/auth/new-password", ...newPasswordPage)
    // Legal pages
    .get("/legal/datenschutz", ...datenschutzPage)
    .get("/impressum", async (c) => {
      const { getSync } = await import("@valentinkolb/cloud-core/services/settings");
      const url = getSync<string>("app.impressum_url");
      if (url) return c.redirect(url, 302);
      return c.text("Impressum not configured", 404);
    })
    // Branding assets (public, no auth, cached)
    .get("/branding/logo", async (c) => {
      return serveBranding(c, "app.logo", join(brandingPublicDir, "logo.svg"), "image/svg+xml");
    })
    .get("/branding/favicon", async (c) => {
      return serveBranding(c, "app.favicon", join(brandingPublicDir, "favicon.png"), "image/x-icon");
    });

  for (const app of apps) {
    if (!app.routes.pages) continue;
    pages.route("/", app.routes.pages);
  }

  // 404 catch-all (must be after all mounted routes)
  pages.get("/*", auth.requireRole("*"), ...notFoundPage);
  return pages;
};

/** Serve a branding asset from settings (base64 data URI) or fall back to a static file. */
async function serveBranding(c: import("hono").Context, settingKey: string, fallbackPath: string, fallbackMime: string): Promise<Response> {
  const dataUri = getSync<string>(settingKey);

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
