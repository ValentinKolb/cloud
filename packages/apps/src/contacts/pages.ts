import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import page from "./frontend/page";
import bookPage from "./frontend/[bookId]/page";
import bookSettingsPage from "./frontend/[bookId]/settings/page";
import contactCreatePage from "./frontend/[bookId]/e/page";
import contactUpsertPage from "./frontend/[bookId]/e/[contactId]/page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...page)
  .get("/:bookId/settings", auth.requireRole("user", auth.redirectToLogin), ...bookSettingsPage)
  .get("/:bookId/e/:contactId", auth.requireRole("user", auth.redirectToLogin), ...contactUpsertPage)
  .get("/:bookId/e", auth.requireRole("user", auth.redirectToLogin), ...contactCreatePage)
  .get("/:bookId", auth.requireRole("user", auth.redirectToLogin), ...bookPage);
