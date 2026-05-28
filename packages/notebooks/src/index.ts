import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import apiRoutes from "./api";
import { notebooksCapabilities } from "./capabilities";
import { app } from "./config";
import pageRoutes, { adminPages as adminPageRoutes } from "./frontend";
import { migrate } from "./migrate";
import { notebooksService, reindexRuntime, snapshotRuntime, yjsSnapshotWorker } from "./service";

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
      await snapshotRuntime.start();
    },
    stop: async () => {
      await yjsSnapshotWorker.stop();
      await reindexRuntime.stop();
      await snapshotRuntime.stop();
    },
  },
});
export default { ...result, websocket };
export type { ApiType } from "./api";
export type {
  CreateNote,
  CreateNotebook,
  Note,
  Notebook,
  NoteTreeNode,
  NoteVersion,
  NoteWithContent,
  UpdateNote,
  UpdateNotebook,
} from "./service";
export { notebooksService as service };
