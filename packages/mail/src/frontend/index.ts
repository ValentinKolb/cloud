import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import automationsPage from "./[mailboxId]/automations/page";
import draftComposePage from "./[mailboxId]/compose/[draftId]/page";
import composePage from "./[mailboxId]/compose/page";
import mailboxPage from "./[mailboxId]/page";
import helpPage from "./help/page";
import page from "./page";

export default new Hono<AuthContext>()
  .get("/help", auth.requireRole("user", auth.redirectToLogin), ...helpPage)
  .get("/help/:topic", auth.requireRole("user", auth.redirectToLogin), ...helpPage)
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...page)
  .get("/:mailboxId/compose/:draftId", auth.requireRole("user", auth.redirectToLogin), ...draftComposePage)
  .get("/:mailboxId/compose", auth.requireRole("user", auth.redirectToLogin), ...composePage)
  .get("/:mailboxId/automations", auth.requireRole("user", auth.redirectToLogin), ...automationsPage)
  .get("/:mailboxId", auth.requireRole("user", auth.redirectToLogin), ...mailboxPage);
