import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import { publicRoutes, adminRoutes } from "./frontend";
import { faqService } from "./service";
import { migrate } from "./migrate";

export default await app.start({
  routes: {
    api: new Hono().route("/faq", apiRoutes),
    pages: new Hono().route("/faq", publicRoutes).route("/admin/faq", adminRoutes),
  },
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
export { faqService as service };
export type { ApiType } from "./api";
export type { FaqService } from "./service";
