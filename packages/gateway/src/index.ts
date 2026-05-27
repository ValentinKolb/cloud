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

import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { logger } from "@valentinkolb/cloud/services";
import { routes } from "@valentinkolb/ssr/hono";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { apiRoutes } from "./api";
import { config } from "./config";
import adminPage from "./frontend/page";
import { buildGatewayHealth } from "./health";
import { proxyRequest } from "./proxy";
import { gatewayRuntime, getCurrentRuntime } from "./runtime";
import { getRouteTable, stats } from "./stats";
import { widgetRoutes } from "./widgets";
import { tryUpgradeWebSocket, websocketHandlers } from "./ws-proxy";

const log = logger("gateway");
const port = parseInt(process.env.PORT ?? "3000", 10);

// ── Admin Hono app (for /admin/gateway page) ────────────────────────────────

const gatewayApp = new Hono<AuthContext>()
  .use("*", async (c, next) => {
    (c as any).set("runtime", getCurrentRuntime());
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
  .get("/admin/gateway", auth.requireRole("admin", auth.redirectToLogin), ...adminPage)
  .route("/api/gateway/widget", widgetRoutes)
  .route("/api/gateway", apiRoutes);

// ── Startup ─────────────────────────────────────────────────────────────────

await gatewayRuntime.setup();
await gatewayRuntime.start();

log.info(`Gateway started on port ${port}`);

// ── Graceful shutdown ───────────────────────────────────────────────────────

const shutdown = async () => {
  log.info("Shutting down...");
  await gatewayRuntime.stop();
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
      if (url.pathname === "/admin/gateway" || url.pathname.startsWith("/admin/gateway/") || url.pathname.startsWith("/public/gateway/")) {
        return new Response("Gateway admin doesn't accept WebSocket", { status: 400 });
      }
      return tryUpgradeWebSocket(req, server, getRouteTable(), (msg, meta) => log.info(msg, meta));
    }

    if (url.pathname === "/health") {
      return Response.json(await buildGatewayHealth());
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
