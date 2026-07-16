import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import draftComposePage from "./[mailboxId]/compose/[draftId]/page";
import composePage from "./[mailboxId]/compose/page";
import mailboxPage from "./[mailboxId]/page";
import mailboxSettingsPage from "./[mailboxId]/settings/page";
import page from "./page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...page)
  .get("/:mailboxId/settings", auth.requireRole("user", auth.redirectToLogin), ...mailboxSettingsPage)
  .get("/:mailboxId/compose/:draftId", auth.requireRole("user", auth.redirectToLogin), ...draftComposePage)
  .get("/:mailboxId/compose", auth.requireRole("user", auth.redirectToLogin), ...composePage)
  .get("/:mailboxId", auth.requireRole("user", auth.redirectToLogin), ...mailboxPage);
