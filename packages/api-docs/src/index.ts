import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import { app } from "./config";
import { apiRoutes } from "./api";
import pageRoutes from "./frontend";

/**
 * Container entrypoint for the api-docs aggregator.
 *
 * The Scalar UI and source catalogue both read the live app registry.
 *
 * Compose middleware ourselves so this app stays consistent with the
 * platform pattern even though it's a single read-only page.
 */
const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/api-docs", apiRoutes)
  .route("/app/api-docs", pageRoutes);

export default await app.start({
  fetch: router.fetch,
});
