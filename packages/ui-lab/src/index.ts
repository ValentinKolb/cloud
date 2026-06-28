import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import pageRoutes from "./frontend";

const uiLabService = {};

const router = new Hono<AuthContext>().use("*", middleware.runtime()).use("*", middleware.settings()).route("/app/ui-lab", pageRoutes);

export default await app.start({ fetch: router.fetch });
export { uiLabService as service };
