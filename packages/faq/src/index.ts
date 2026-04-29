import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import { publicRoutes, adminRoutes } from "./frontend";
import { faqService } from "./service";
import { migrate } from "./migrate";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/faq", apiRoutes)
  .route("/faq", publicRoutes)
  .route("/admin/faq", adminRoutes);

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
export { faqService as service };
export type { ApiType } from "./api";
export type { FaqService } from "./service";
