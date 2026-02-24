import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import pageRoutes from "./pages";
import { accountsService } from "./service";

const app = {
  meta: {
    id: "accounts",
    name: "Accounts",
    icon: "ti ti-users-group",
    description: "Manage users, groups, and account requests.",
    nav: {
      href: "/app/accounts",
      match: "/app/accounts",
      section: "more",
      requiresAuth: true,
      requiresRoles: ["ipa"],
    },
  },
  service: accountsService,
  routes: {
    api: new Hono().route("/ipa", apiRoutes),
    pages: new Hono().route("/app/accounts", pageRoutes),
  },
} satisfies AppFacade<typeof accountsService>;

export default app;
export { accountsService as service };
export type { ApiType } from "./api";

export type { UsersService } from "./service";
export type { GroupsService } from "./service";
export type {
  AccountRequestsService,
  AccountRequest,
  AccountRequestStatus,
} from "./service";
