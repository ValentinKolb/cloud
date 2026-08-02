import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import apiRoutes from "./api";
import { app } from "./config";
import { adminRoutes, publicRoutes } from "./frontend";
import { faqHelp } from "./help";
import { migrate } from "./migrate";
import { faqService } from "./service";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/faq", apiRoutes)
  .route("/faq", publicRoutes)
  .route("/admin/faq", adminRoutes);

export default await app.start({
  fetch: router.fetch,
  help: faqHelp,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
export type { ApiType } from "./api";
export type { FaqService } from "./service";
export { faqService as service };
