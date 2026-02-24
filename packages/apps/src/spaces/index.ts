import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import pageRoutes from "./pages";
import adminPageRoutes from "./adminPages";
import { createUpcomingEventsWidget } from "./widgets/upcoming-events";
import { createMyTasksWidget } from "./widgets/my-tasks";
import { spacesService } from "./service";
import { migrate } from "./migrate";

const app = {
  meta: {
    id: "spaces",
    name: "Spaces",
    icon: "ti ti-layout-kanban",
    description: "Plan, track, and collaborate on boards, tasks, and events.",
    adminHref: "/admin/spaces",
    nav: {
      href: "/app/spaces?recent=true",
      match: "/app/spaces",
      section: "primary",
      requiresAuth: true,
      requiresRoles: ["ipa"],
    },
  },
  service: spacesService,
  routes: {
    api: new Hono().route("/app/spaces", apiRoutes),
    pages: new Hono().route("/app/spaces", pageRoutes).route("/admin/spaces", adminPageRoutes),
  },
  widgets: [createUpcomingEventsWidget, createMyTasksWidget],
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
} satisfies AppFacade<typeof spacesService>;

export default app;
export { spacesService as service };
export type { ApiType } from "./api";
export type { TaskItem } from "./service";
