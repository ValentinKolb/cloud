import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import pageRoutes from "./pages";

const uiLabService = {};

const app = {
  meta: {
    id: "ui-lab",
    name: "UI Lab",
    icon: "ti ti-palette",
    description: "Static showcase of shared UI components and styles.",
    nav: {
      href: "/app/ui-lab",
      match: "/app/ui-lab",
      section: "more",
      requiresAuth: true,
    },
  },
  service: uiLabService,
  routes: {
    pages: new Hono().route("/app/ui-lab", pageRoutes),
  },
} satisfies AppFacade<typeof uiLabService>;

export default app;
export { uiLabService as service };
