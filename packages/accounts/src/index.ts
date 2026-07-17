import { type AuthContext, auth, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import apiRoutes from "./api";
import { app } from "./config";
import pageRoutes from "./frontend";
import { accountsHelp } from "./help";

const service = {};
const helpRoutes = new Hono<AuthContext>().use(auth.requireRole("user")).route("/", accountsHelp.router);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/accounts/help", helpRoutes)
  .route("/api/accounts", apiRoutes)
  .route("/app/accounts", pageRoutes);

export default await app.start({ fetch: router.fetch, openapi: apiRoutes });
export type { ApiType } from "./api";
export { service };
