import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import pageRoutes from "./pages";

const service = {};

const app = {
  meta: {
    id: "accounts",
    name: "Accounts",
    icon: "ti ti-users-group",
    description: "Manage account access, groups, and account requests.",
    nav: {
      href: "/app/accounts",
      match: "/app/accounts",
      section: "more",
      requiresAuth: true,
      requiresRoles: ["user"],
    },
  },
  service,
  routes: {
    api: new Hono().route("/accounts", apiRoutes),
    pages: new Hono().route("/app/accounts", pageRoutes),
  },
} satisfies AppFacade<typeof service>;

export default app;
export { service };
export type { ApiType } from "./api";
