import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import notebooksPage from "./page";
import notebookDetailPage from "./[id]/page";
import notebookAttachmentsPage from "./[id]/attachments/page";
import notebooksAdminPage from "./admin";

export const adminPages = new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...notebooksAdminPage);

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("authenticated", auth.redirectToLogin), ...notebooksPage)
  .get("/:id", auth.requireRole("authenticated", auth.redirectToLogin), ...notebookDetailPage)
  .get("/:id/attachments", auth.requireRole("authenticated", auth.redirectToLogin), ...notebookAttachmentsPage);
