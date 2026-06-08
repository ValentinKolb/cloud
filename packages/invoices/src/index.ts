import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AppContext, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { migrate } from "./migrate";

export type InvoicesAppContext = AppContext<typeof app>;

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/invoices", apiRoutes)
  .route("/app/invoices", pageRoutes);

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
