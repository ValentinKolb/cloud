import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import adminPageRoutes from "./frontend";
import { ipaHostsService } from "./service";
import { migrate } from "./migrate";
import { ipaHosts } from "./backend";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/ipa-hosts", apiRoutes)
  .route("/admin/ipa-hosts", adminPageRoutes);

export default await app.start({
  fetch: router.fetch,
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
