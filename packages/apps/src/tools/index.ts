import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import pageRoutes from "./pages";
import { createToolsWidget } from "./widget";

const toolsService = {};

const app = {
  meta: {
    id: "tools",
    name: "Tools",
    icon: "ti ti-tools",
    description: "Utility tools for day-to-day work tasks.",
    nav: {
      href: "/tools",
      match: "/tools",
      section: "more",
    },
  },
  service: toolsService,
  routes: {
    pages: new Hono().route("/tools", pageRoutes),
  },
  widgets: [createToolsWidget],
} satisfies AppFacade<typeof toolsService>;

export default app;
export { toolsService as service };
