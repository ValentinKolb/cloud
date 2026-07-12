import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import mailboxPage from "./[mailboxId]/page";
import mailboxSettingsPage from "./[mailboxId]/settings/page";
import page from "./page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...page)
  .get("/:mailboxId/settings", auth.requireRole("user", auth.redirectToLogin), ...mailboxSettingsPage)
  .get("/:mailboxId", auth.requireRole("user", auth.redirectToLogin), ...mailboxPage);
