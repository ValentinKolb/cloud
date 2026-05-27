import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import apiRoutes from "./api";
import { contactsCapabilities } from "./capabilities";
import { app } from "./config";
import pageRoutes, { adminPages as adminPageRoutes } from "./frontend";
import { migrate } from "./migrate";
import { contactsService } from "./service";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/contacts", apiRoutes)
  .route("/app/contacts", pageRoutes)
  .route("/admin/contacts", adminPageRoutes);

export default await app.start({
  capabilities: contactsCapabilities,
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
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
