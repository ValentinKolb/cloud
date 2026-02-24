import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import pageRoutes from "./pages";
import { contactsService } from "./service";
import { migrate } from "./migrate";

const app = {
  meta: {
    id: "contacts",
    name: "Contacts",
    icon: "ti ti-address-book",
    description: "Business contact books with structured emails, phones, postal addresses, and IPA system directory projection.",
    nav: {
      href: "/app/contacts",
      match: "/app/contacts",
      section: "primary",
      requiresAuth: true,
      requiresRoles: ["ipa"],
    },
  },
  service: contactsService,
  routes: {
    api: new Hono().route("/app/contacts", apiRoutes),
    pages: new Hono().route("/app/contacts", pageRoutes),
  },
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
} satisfies AppFacade<typeof contactsService>;

export default app;
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
