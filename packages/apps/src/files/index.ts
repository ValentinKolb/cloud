import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import pageRoutes from "./pages";
import adminPageRoutes from "./adminPages";
import { createFilesWidget } from "./widget";
import { filesService } from "./service";
import { filesCapabilities } from "./capabilities";

const app = {
  meta: {
    id: "files",
    name: "Files",
    icon: "ti ti-folders",
    description: "Browse, upload, move, and manage files across accessible bases.",
    color: "zinc",
    adminHref: "/admin/files",
    nav: {
      href: "/app/files",
      match: "/app/files",
      section: "primary",
      requiresAuth: true,
      requiresRoles: ["ipa"],
    },
  },
  service: filesService,
  capabilities: filesCapabilities,
  routes: {
    api: new Hono().route("/app/files", apiRoutes),
    pages: new Hono().route("/app/files", pageRoutes).route("/admin/files", adminPageRoutes),
  },
  widgets: [createFilesWidget],
} satisfies AppFacade<typeof filesService>;

export default app;
export { filesService as service };
export type { ApiType } from "./api";
