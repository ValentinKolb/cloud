import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import { quotesService } from "./service";

const router = new Hono<AuthContext>().use("*", middleware.runtime()).use("*", middleware.settings()).route("/api/quotes", apiRoutes);

export default await app.start({ fetch: router.fetch, openapi: apiRoutes });
export { quotesService as service };
export type { ApiType } from "./api";
