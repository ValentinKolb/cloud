import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { contactsService } from "./service";
import { migrate } from "./migrate";
import { contactsCapabilities } from "./capabilities";

export default await app.start({
  capabilities: contactsCapabilities,
  routes: {
    api: new Hono().route("/app/contacts", apiRoutes),
    pages: new Hono().route("/app/contacts", pageRoutes),
  },
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
