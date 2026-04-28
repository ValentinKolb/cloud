import { Hono } from "hono";
import { app } from "./config";
import apiRoutes from "./api";
import widgetRoutes from "./api/widgets";
import pageRoutes from "./frontend";
import { adminPages as adminPageRoutes } from "./frontend";
import { migrate } from "./migrate";
import { expeditionsService } from "./service";

/**
 * Container entrypoint for the expeditions app.
 *
 * `app.start()` does the heavy lifting: spins up Hono, registers the
 * platform middleware (auth session loading, request logging, rate
 * limiting, settings snapshot), wires our route bundles into the global
 * paths the gateway expects, runs `lifecycle.setup` once on boot, and
 * starts heartbeating into the Redis registry so the gateway picks the
 * container up within a few seconds.
 *
 * Route mounting:
 *   /api/expeditions/widgets/*  → widget endpoints (called by dashboard)
 *   /api/app/expeditions/*      → CRUD API (called by islands)
 *   /app/expeditions/*          → SSR pages
 *   /admin/expeditions/*        → admin SSR pages (admin-gated)
 */
export default await app.start({
  routes: {
    api: new Hono()
      .route("/expeditions/widgets", widgetRoutes)
      .route("/app/expeditions", apiRoutes),
    pages: new Hono()
      .route("/app/expeditions", pageRoutes)
      .route("/admin/expeditions", adminPageRoutes),
  },
  lifecycle: {
    // Runs once per container boot. Idempotent — safe to re-run on every
    // restart. Never destructive.
    setup: async () => {
      await migrate();
    },
  },
});

// Re-export the service for any sibling app that wants to read expeditions
// data (none currently do, but the convention matches notebooks/spaces).
export { expeditionsService as service };
export type { ApiType } from "./api";
