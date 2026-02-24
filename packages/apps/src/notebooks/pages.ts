import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import notebooksPage from "./frontend/page";
import notebookDetailPage from "./frontend/[id]/page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("authenticated", auth.redirectToLogin), ...notebooksPage)
  .get("/:id", auth.requireRole("authenticated", auth.redirectToLogin), ...notebookDetailPage);
