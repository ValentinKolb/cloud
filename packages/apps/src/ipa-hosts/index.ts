import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import adminPageRoutes from "./pages";
import { ipaHostsService } from "./service";
import { migrate } from "./migrate";
import { ipaHosts } from "./backend";

const app = {
  meta: {
    id: "ipa-hosts",
    name: "Hosts",
    icon: "ti ti-server",
    description: "Manage FreeIPA hosts, hostgroups, and mirrored host membership data.",
    color: "orange",
    adminHref: "/admin/ipa-hosts",
  },
  service: ipaHostsService,
  routes: {
    api: new Hono().route("/ipa-hosts", apiRoutes),
    pages: new Hono().route("/admin/ipa-hosts", adminPageRoutes),
  },
  lifecycle: {
    setup: async () => {
      await migrate();
    },
    start: async () => {
      await ipaHosts.sync.start();
    },
    stop: async () => {
      await ipaHosts.sync.stop();
    },
  },
} satisfies AppFacade<typeof ipaHostsService>;

export default app;
export { ipaHostsService as service };
export type { ApiType } from "./api";
export type { IpaHostsService } from "./service";
