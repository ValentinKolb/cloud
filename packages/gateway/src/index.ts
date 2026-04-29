/**
 * Gateway — Bun HTTP reverse proxy with dynamic route discovery.
 *
 * Replaces Traefik for development. Discovers routes from the app registry
 * (Redis) and uses a prefix trie for O(segments) matching.
 *
 * Unlike normal apps, the gateway does NOT use app.start() because it IS
 * the HTTP server — it can't proxy to itself. Instead it:
 * - Directly creates a Bun.serve-compatible export
 * - Registers itself in the registry via createHeartbeat
 * - Mounts its own admin page alongside the proxy
 */
import { Hono } from "hono";
import { routes } from "@valentinkolb/ssr/hono";
import { serveStatic } from "hono/bun";
import {
  listApps,
  createHeartbeat,
  appRegistry,
  buildRuntimeFromRegistry,
} from "@valentinkolb/cloud";
import type { AppRegistryEntry } from "@valentinkolb/cloud/contracts";
import { logger, loadCache as loadSettingsCache } from "@valentinkolb/cloud/services";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import { buildRouteTable } from "./trie";
import { buildAppRoutes } from "./routes";
import { proxyRequest } from "./proxy";
import { tryUpgradeWebSocket, websocketHandlers } from "./ws-proxy";
import { getRouteTable, setRouteTable, stats } from "./stats";
import { app, config } from "./config";
import adminPage from "./frontend/page";
import { widgetRoutes } from "./widgets";

const log = logger("gateway");
const port = parseInt(process.env.PORT ?? "3000", 10);

// ── Route refresh (only rebuild when data changed) ──────────────────────────

let lastRouteHash = "";

const refreshRoutes = async () => {
  try {
    const apps = await listApps();
    const appRoutes = buildAppRoutes(apps);

    // Only rebuild trie if routes actually changed
    const routeHash = JSON.stringify(
      appRoutes.map((r) => `${r.prefix}:${r.baseUrl}`).sort(),
    );
    if (routeHash === lastRouteHash) return;

    lastRouteHash = routeHash;
    const table = buildRouteTable(appRoutes);
    setRouteTable(table);
    log.info(`Route table rebuilt: ${table.routeCount} routes from ${apps.length} apps`);

    // Also refresh runtime context for admin page
    currentRuntime = buildRuntimeFromRegistry(apps);
  } catch (err) {
    log.error("Route refresh failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

// ── Runtime context (for admin page Layout/AdminSidebar) ────────────────────

let currentRuntime = buildRuntimeFromRegistry([]);

// ── Heartbeat (register gateway as app) ─────────────────────────────────────

const registryEntry: AppRegistryEntry = {
  id: app.meta.id,
  name: app.meta.name,
  icon: app.meta.icon,
  description: app.meta.description,
  baseUrl: app.baseUrl,
  routes: app.meta.routes,
  nav: {
    href: "",
    section: "hidden",
    adminHref: app.meta.adminHref,
  },
  widgets: app.meta.widgets ? app.meta.widgets.map((w) => ({ ...w })) : undefined,
};

const heartbeat = createHeartbeat(app.meta.id, registryEntry);

// ── Admin Hono app (for /admin/gateway page) ────────────────────────────────

const gatewayApp = new Hono<AuthContext>()
  .use("*", async (c, next) => {
    (c as any).set("runtime", currentRuntime);
    await next();
  })
  .route("/admin/gateway/_ssr", routes(config))
  .use(
    "/public/*",
    serveStatic({
      root: "./",
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  )
  .get(
    "/admin/gateway",
    auth.requireRole("admin", auth.redirectToLogin),
    ...adminPage,
  )
  .route("/api/gateway/widget", widgetRoutes);

// ── Startup ─────────────────────────────────────────────────────────────────

await loadSettingsCache();
await heartbeat.start();
await refreshRoutes();

// Periodic refresh (every 5s)
setInterval(refreshRoutes, 5_000);

// Registry watcher for immediate updates
(async () => {
  try {
    const snap = await appRegistry.snapshot({ prefix: "apps/" });
    for await (const _ev of appRegistry
      .reader({ prefix: "apps/", after: snap.cursor })
      .stream()) {
      await refreshRoutes();
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    log.error("Registry watcher failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
})();

log.info(`Gateway started on port ${port}`);

// ── Graceful shutdown ───────────────────────────────────────────────────────

const shutdown = async () => {
  log.info("Shutting down...");
  await heartbeat.stop();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// ── Bun.serve export ────────────────────────────────────────────────────────

export default {
  port,
  async fetch(
    req: Request,
    server: { upgrade: (req: Request, options?: { data?: unknown; headers?: Record<string, string> }) => boolean },
  ): Promise<Response | undefined> {
    const url = new URL(req.url);

    // WebSocket Upgrade requests need separate handling — Bun's `fetch()`
    // (used by the HTTP proxy) does not pass through Upgrade handshakes.
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      // The gateway's own admin pages don't accept WS.
      if (
        url.pathname === "/admin/gateway" ||
        url.pathname.startsWith("/admin/gateway/") ||
        url.pathname.startsWith("/public/gateway/")
      ) {
        return new Response("Gateway admin doesn't accept WebSocket", { status: 400 });
      }
      return tryUpgradeWebSocket(req, server, getRouteTable(), (msg, meta) => log.info(msg, meta));
    }

    // Gateway's own admin routes + its SSR/public assets + dashboard widgets
    if (
      url.pathname === "/admin/gateway" ||
      url.pathname.startsWith("/admin/gateway/") ||
      url.pathname.startsWith("/public/gateway/") ||
      url.pathname.startsWith("/api/gateway/")
    ) {
      return gatewayApp.fetch(req);
    }

    // Proxy everything else
    return proxyRequest(req, getRouteTable(), stats, (msg, meta) => {
      log.info(msg, meta);
    });
  },
  websocket: websocketHandlers,
};
