import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import pageRoutes from "./pages";
import { oauthService } from "./service";
import { migrate } from "./migrate";

const app = {
  meta: {
    id: "oauth",
    name: "OAuth",
    icon: "ti ti-key",
    description: "Manage OAuth/OIDC clients, redirects, scopes, and secrets.",
    color: "violet",
    adminHref: "/admin/oauth",
  },
  service: oauthService,
  routes: {
    api: new Hono().route("/admin/oauth/clients", apiRoutes),
    pages: new Hono().route("/", pageRoutes),
  },
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
} satisfies AppFacade<typeof oauthService>;

export default app;
export { oauthService as service };
export type { ApiType } from "./api";
export type { OauthService } from "./service";
