import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import automationsPage from "./[mailboxId]/automations/page";
import draftComposePage from "./[mailboxId]/compose/[draftId]/page";
import mailboxPage from "./[mailboxId]/page";
import subscriptionsPage from "./[mailboxId]/subscriptions/page";
import composePage from "./compose/page";
import helpPage from "./help/page";
import page from "./page";

export default new Hono<AuthContext>()
  .get("/help", auth.requireRole("user", auth.redirectToLogin), ...helpPage)
  .get("/help/:topic", auth.requireRole("user", auth.redirectToLogin), ...helpPage)
  .get("/compose", auth.requireRole("user", auth.redirectToLogin), ...composePage)
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...page)
  .get("/:mailboxId/compose/:draftId", auth.requireRole("user", auth.redirectToLogin), ...draftComposePage)
  .get("/:mailboxId/automations", auth.requireRole("user", auth.redirectToLogin), ...automationsPage)
  .get("/:mailboxId/subscriptions", auth.requireRole("user", auth.redirectToLogin), ...subscriptionsPage)
  .get("/:mailboxId", auth.requireRole("user", auth.redirectToLogin), ...mailboxPage);
