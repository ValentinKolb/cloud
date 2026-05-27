import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import contactUpsertPage from "./[bookId]/e/[contactId]/page";
import contactCreatePage from "./[bookId]/e/page";
import bookPage from "./[bookId]/page";
import bookSettingsPage from "./[bookId]/settings/page";
import adminPage from "./admin";
import page from "./page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...page)
  .get("/:bookId/settings", auth.requireRole("user", auth.redirectToLogin), ...bookSettingsPage)
  .get("/:bookId/e/:contactId", auth.requireRole("user", auth.redirectToLogin), ...contactUpsertPage)
  .get("/:bookId/e", auth.requireRole("user", auth.redirectToLogin), ...contactCreatePage)
  .get("/:bookId", auth.requireRole("user", auth.redirectToLogin), ...bookPage);

export const adminPages = new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...adminPage);
