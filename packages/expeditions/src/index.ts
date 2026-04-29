import { Hono } from "hono";
import { app } from "./config";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { adminPages as adminPageRoutes } from "./frontend";
import { migrate } from "./migrate";
import { expeditionsService } from "./service";

/**
 * Container entrypoint for the expeditions app.
 *
 * `app.start()` spins up Hono, registers the platform middleware (auth
 * session loading, request logging, rate limiting, settings snapshot),
 * wires our route bundles into the global paths the gateway expects, runs
 * `lifecycle.setup` once on boot, and heartbeats into the Redis registry.
 *
 * Standard four-prefix mount:
 *   /api/expeditions/*    — widget + CRUD endpoints (api/index.ts handles split)
 *   /app/expeditions/*    — SSR pages
 *   /admin/expeditions/*  — admin SSR pages (admin-gated)
 *   /public/expeditions/* — built CSS, served automatically by the framework
 */
export default await app.start({
  router: new Hono()
    .route("/api/expeditions", apiRoutes)
    .route("/app/expeditions", pageRoutes)
    .route("/admin/expeditions", adminPageRoutes),
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
