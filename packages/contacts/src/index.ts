import { type AuthContext, auth, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import apiRoutes from "./api";
import { capabilityRetention } from "./capability-retention";
import { contactsCapabilities } from "./capabilities";
import { app } from "./config";
import pageRoutes, { adminPages as adminPageRoutes } from "./frontend";
import { contactsHelp } from "./help";
import { migrate } from "./migrate";
import { contactsService } from "./service";

const helpRoutes = new Hono<AuthContext>().use(auth.requireRole("user")).route("/", contactsHelp.router);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/contacts/help", helpRoutes)
  .route("/api/contacts", apiRoutes)
  .route("/app/contacts", pageRoutes)
  .route("/admin/contacts", adminPageRoutes);

const result = await app.start({
  capabilities: contactsCapabilities,
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
    start: capabilityRetention.start,
    stop: capabilityRetention.stop,
  },
});
export default { ...result, websocket };
export type { ApiType } from "./api";
export type {
  Contact,
  ContactBook,
  CreateBookInput,
  CreateContactInput,
  UpdateBookInput,
  UpdateContactInput,
} from "./service";
export { contactsService as service };
