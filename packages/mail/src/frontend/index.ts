import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import automationActivityPage from "./[mailboxId]/automations/activity/page";
import incomingAutomationsPage from "./[mailboxId]/automations/incoming/page";
import automationsPage from "./[mailboxId]/automations/page";
import automaticRepliesPage from "./[mailboxId]/automations/replies/page";
import workflowsPage from "./[mailboxId]/automations/workflows/page";
import draftComposePage from "./[mailboxId]/compose/[draftId]/page";
import draftSeedComposePage from "./[mailboxId]/compose/local/[seedId]/page";
import mailboxPage from "./[mailboxId]/page";
import subscriptionsPage from "./[mailboxId]/subscriptions/page";
import composePage from "./compose/page";
import page from "./page";

export default new Hono<AuthContext>()
  .get("/compose", auth.requireRole("user", auth.redirectToLogin), ...composePage)
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...page)
  .get("/:mailboxId/compose/local/:seedId", auth.requireRole("user", auth.redirectToLogin), ...draftSeedComposePage)
  .get("/:mailboxId/compose/:draftId", auth.requireRole("user", auth.redirectToLogin), ...draftComposePage)
  .get("/:mailboxId/automations", auth.requireRole("user", auth.redirectToLogin), ...automationsPage)
  .get("/:mailboxId/automations/replies", auth.requireRole("user", auth.redirectToLogin), ...automaticRepliesPage)
  .get("/:mailboxId/automations/incoming", auth.requireRole("user", auth.redirectToLogin), ...incomingAutomationsPage)
  .get("/:mailboxId/automations/activity", auth.requireRole("user", auth.redirectToLogin), ...automationActivityPage)
  .get("/:mailboxId/automations/workflows", auth.requireRole("user", auth.redirectToLogin), ...workflowsPage)
  .get("/:mailboxId/subscriptions", auth.requireRole("user", auth.redirectToLogin), ...subscriptionsPage)
  .get("/:mailboxId", auth.requireRole("user", auth.redirectToLogin), ...mailboxPage);
