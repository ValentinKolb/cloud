import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import widgetRoutes from "./api/widgets";
import adminPageRoutes from "./frontend";
import { ipaHostsService } from "./service";
import { migrate } from "./migrate";
import { ipaHosts } from "./backend";

export default await app.start({
  routes: {
    api: new Hono()
      .route("/ipa-hosts/widgets", widgetRoutes)
      .route("/admin/ipa-hosts", apiRoutes),
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
});
export { ipaHostsService as service };
export type { ApiType } from "./api";
export type { IpaHostsService } from "./service";
