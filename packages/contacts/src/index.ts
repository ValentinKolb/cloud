import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { contactsService } from "./service";
import { migrate } from "./migrate";
import { contactsCapabilities } from "./capabilities";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/contacts", apiRoutes)
  .route("/app/contacts", pageRoutes);

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
export { contactsService as service };
export type { ApiType } from "./api";
export type {
  ContactBook,
  Contact,
  CreateBookInput,
  UpdateBookInput,
  CreateContactInput,
  UpdateContactInput,
} from "./service";
