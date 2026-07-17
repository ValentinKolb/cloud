import { type AuthContext, auth, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import apiRoutes from "./api";
import { app } from "./config";
import pageRoutes from "./frontend";
import { venueHelp } from "./help";
import { migrate } from "./migrate";

const helpRoutes = new Hono<AuthContext>().use(auth.requireRole("user")).route("/", venueHelp.router);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/venue/help", helpRoutes)
  .route("/api/venue", apiRoutes)
  .route("/app/venue", pageRoutes);

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});

export type { ApiType } from "./api";
