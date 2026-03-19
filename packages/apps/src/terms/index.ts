import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import pageRoutes from "./pages";
import adminPageRoutes from "./adminPages";
import { termsService } from "./service";
import { migrate } from "./migrate";

const app = {
  meta: {
    id: "terms",
    name: "Terms of Service",
    icon: "ti ti-file-text",
    description: "Manage and publish legal terms versions.",
    color: "rose",
  },
  service: termsService,
  routes: {
    api: new Hono().route("/admin/terms", apiRoutes),
    pages: new Hono().route("/legal/agb", pageRoutes).route("/admin/terms", adminPageRoutes),
  },
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
} satisfies AppFacade<typeof termsService>;

export default app;
export { termsService as service };
export type { ApiType } from "./api";
export type { TermsService } from "./service";
