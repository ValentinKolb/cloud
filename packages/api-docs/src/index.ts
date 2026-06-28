import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import { app } from "./config";
import pageRoutes from "./frontend";

/**
 * Container entrypoint for the api-docs aggregator.
 *
 * Pages-only — the Scalar UI is the single page mounted at `/app/api-docs`.
 * No own API surface; the docs it shows belong to the other apps.
 *
 * Compose middleware ourselves so this app stays consistent with the
 * platform pattern even though it's a single read-only page.
 */
const router = new Hono<AuthContext>().use("*", middleware.runtime()).use("*", middleware.settings()).route("/app/api-docs", pageRoutes);

export default await app.start({
  fetch: router.fetch,
});
