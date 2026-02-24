import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import page from "./frontend/page";
import bookPage from "./frontend/[bookId]/page";
import bookSettingsPage from "./frontend/[bookId]/settings/page";
import contactCreatePage from "./frontend/[bookId]/e/page";
import contactUpsertPage from "./frontend/[bookId]/e/[contactId]/page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("ipa", auth.redirectToLogin), ...page)
  .get("/:bookId/settings", auth.requireRole("ipa", auth.redirectToLogin), ...bookSettingsPage)
  .get("/:bookId/e/:contactId", auth.requireRole("ipa", auth.redirectToLogin), ...contactUpsertPage)
  .get("/:bookId/e", auth.requireRole("ipa", auth.redirectToLogin), ...contactCreatePage)
  .get("/:bookId", auth.requireRole("ipa", auth.redirectToLogin), ...bookPage);
