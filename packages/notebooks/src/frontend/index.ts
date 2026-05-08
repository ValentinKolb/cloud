import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import notebooksPage from "./page";
import notebookDetailPage from "./[id]/page";
import notebookAttachmentsPage from "./[id]/attachments/page";
import notebookTagPage from "./[id]/tags/[tag]/page";
import notebooksAdminPage from "./admin";

export const adminPages = new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...notebooksAdminPage);

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("authenticated", auth.redirectToLogin), ...notebooksPage)
  // Both `/notebooks/:id` and `/notebooks/:id/notes/:noteId` hit the same
  // SSR handler — the latter just supplies a `noteId` route param. The
  // handler reads both shape variants from `c.req.param(...)`.
  .get("/:id", auth.requireRole("authenticated", auth.redirectToLogin), ...notebookDetailPage)
  .get("/:id/notes/:noteId", auth.requireRole("authenticated", auth.redirectToLogin), ...notebookDetailPage)
  .get("/:id/attachments", auth.requireRole("authenticated", auth.redirectToLogin), ...notebookAttachmentsPage)
  .get("/:id/tags/:tag", auth.requireRole("authenticated", auth.redirectToLogin), ...notebookTagPage);
