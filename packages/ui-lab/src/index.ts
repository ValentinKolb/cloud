import { type AuthContext, auth, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { app } from "./config";
import pageRoutes from "./frontend";
import { uiLabHelp } from "./help";

const uiLabService = {};

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/ui-lab/help", new Hono<AuthContext>().use(auth.requireRole("*")).route("/", uiLabHelp.router))
  .route("/app/ui-lab", pageRoutes);

export default await app.start({ fetch: router.fetch });
export { uiLabService as service };
