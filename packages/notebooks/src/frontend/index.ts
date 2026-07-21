import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import notebookAttachmentsPage from "./[id]/attachments/page";
import notebookDetailPage from "./[id]/page";
import notebookTagPage from "./[id]/tags/[tag]/page";
import notebooksAdminPage from "./admin";
import helpPage from "./help/page";
import notebooksPage from "./page";

export const adminPages = new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...notebooksAdminPage);

export default new Hono<AuthContext>()
  .get("/help", auth.requireRole("authenticated", auth.redirectToLogin), ...helpPage)
  .get("/help/:topic", auth.requireRole("authenticated", auth.redirectToLogin), ...helpPage)
  .get("/", auth.requireRole("authenticated", auth.redirectToLogin), ...notebooksPage)
  // Both `/notebooks/:id` and `/notebooks/:id/notes/:noteId` hit the same
  // SSR handler — the latter just supplies a `noteId` route param. The
  // handler reads both shape variants from `c.req.param(...)`.
  .get("/:id", auth.requireRole("authenticated", auth.redirectToLogin), ...notebookDetailPage)
  .get("/:id/notes/:noteId", auth.requireRole("authenticated", auth.redirectToLogin), ...notebookDetailPage)
  .get("/:id/attachments", auth.requireRole("authenticated", auth.redirectToLogin), ...notebookAttachmentsPage)
  .get("/:id/tags/:tag", auth.requireRole("authenticated", auth.redirectToLogin), ...notebookTagPage);
