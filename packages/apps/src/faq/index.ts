import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import pageRoutes from "./pages";
import adminPageRoutes from "./adminPages";
import { faqService } from "./service";
import { migrate } from "./migrate";

const app = {
  meta: {
    id: "faq",
    name: "FAQ",
    icon: "ti ti-help-circle",
    description: "Frequently asked questions and public help content.",
    color: "cyan",
  },
  service: faqService,
  routes: {
    api: new Hono().route("/admin/faq", apiRoutes),
    pages: new Hono().route("/faq", pageRoutes).route("/admin/faq", adminPageRoutes),
  },
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
} satisfies AppFacade<typeof faqService>;

export default app;
export { faqService as service };
export type { ApiType } from "./api";
export type { FaqService } from "./service";
