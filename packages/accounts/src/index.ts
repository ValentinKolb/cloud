import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes from "./frontend";

const service = {};

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/accounts", apiRoutes)
  .route("/app/accounts", pageRoutes);

export default await app.start({ fetch: router.fetch, openapi: apiRoutes });
export { service };
export type { ApiType } from "./api";
