import { app } from "./config";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { adminPages as adminPageRoutes } from "./frontend";
import { notebooksService, reindexRuntime, yjsSnapshotWorker } from "./service";
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
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
    start: async () => {
      yjsSnapshotWorker.start();
      // Periodic note-refs reindex (links + tags + attachments). Also
      // kicks off a one-shot startup backfill so newly-deployed schema
      // changes get picked up without waiting for the next cron tick.
      await reindexRuntime.start();
    },
    stop: async () => {
      await yjsSnapshotWorker.stop();
      await reindexRuntime.stop();
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
