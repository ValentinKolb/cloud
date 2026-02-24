import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import wsRoutes from "./ws";
import pageRoutes from "./pages";
import adminPageRoutes from "./adminPages";
import { notebooksService, yjsManager } from "./service";
import { migrate } from "./migrate";

const app = {
  meta: {
    id: "notebooks",
    name: "Notebooks",
    icon: "ti ti-notebook",
    description: "Collaborative notebooks with structured notes and realtime sync.",
    adminHref: "/admin/notebooks",
    nav: {
      href: "/app/notebooks?recent=true",
      match: "/app/notebooks",
      section: "primary",
      requiresAuth: true,
    },
  },
  service: notebooksService,
  routes: {
    api: new Hono().route("/app/notebooks", apiRoutes),
    pages: new Hono().route("/app/notebooks", pageRoutes).route("/admin/notebooks", adminPageRoutes),
    ws: new Hono().route("/", wsRoutes),
  },
  lifecycle: {
    setup: async () => {
      await migrate();
    },
    start: async () => {
      yjsManager.start();
    },
    stop: async () => {
      yjsManager.stop();
    },
  },
} satisfies AppFacade<typeof notebooksService>;

export default app;
export { notebooksService as service };
export type { ApiType } from "./api";
export type { Notebook, CreateNotebook, UpdateNotebook } from "./service";
export type {
  Note,
  NoteWithContent,
  NoteTreeNode,
  CreateNote,
  UpdateNote,
  NoteVersion,
} from "./service";
