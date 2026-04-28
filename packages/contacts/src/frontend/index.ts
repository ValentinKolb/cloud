import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import page from "./page";
import bookPage from "./[bookId]/page";
import bookSettingsPage from "./[bookId]/settings/page";
import contactCreatePage from "./[bookId]/e/page";
import contactUpsertPage from "./[bookId]/e/[contactId]/page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...page)
  .get("/:bookId/settings", auth.requireRole("user", auth.redirectToLogin), ...bookSettingsPage)
  .get("/:bookId/e/:contactId", auth.requireRole("user", auth.redirectToLogin), ...contactUpsertPage)
  .get("/:bookId/e", auth.requireRole("user", auth.redirectToLogin), ...contactCreatePage)
  .get("/:bookId", auth.requireRole("user", auth.redirectToLogin), ...bookPage);
