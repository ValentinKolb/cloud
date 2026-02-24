import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import adminPageRoutes from "./pages";
import { hostsService } from "./service";

const app = {
  meta: {
    id: "hosts",
    name: "Hosts",
    icon: "ti ti-server",
    description: "Manage hosts, hostgroups, and host memberships.",
    color: "orange",
    adminHref: "/admin/hosts",
  },
  service: hostsService,
  routes: {
    api: new Hono().route("/ipa/hosts", apiRoutes),
    pages: new Hono().route("/admin/hosts", adminPageRoutes),
  },
} satisfies AppFacade<typeof hostsService>;

export default app;
export { hostsService as service };
export type { ApiType } from "./api";
export type { HostsService } from "./service";
