import { app } from "./config";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { adminPages as adminPageRoutes } from "./frontend";
import { notebooksService, yjsSnapshotWorker } from "./service";
import { migrate } from "./migrate";
import { notebooksCapabilities } from "./capabilities";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/notebooks", apiRoutes)
  .route("/app/notebooks", pageRoutes)
  .route("/admin/notebooks", adminPageRoutes);

const result = await app.start({
  capabilities: notebooksCapabilities,
  fetch: router.fetch,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
    start: async () => {
      yjsSnapshotWorker.start();
    },
    stop: async () => {
      await yjsSnapshotWorker.stop();
    },
  },
});
export default { ...result, websocket };
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
