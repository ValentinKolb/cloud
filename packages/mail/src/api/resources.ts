import type { AuthContext } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import aiAutomationRoutes from "./ai-automations";
import automaticReplyRoutes from "./automatic-replies";
import conversationReferenceRoutes from "./conversation-references";
import localTagRoutes from "./local-tags";
import mailRuleRoutes from "./mail-rules";
import mailboxLifecycleRoutes from "./mailbox-lifecycle";
import remoteContentRoutes from "./remote-content";

export default new Hono<AuthContext>()
  .route("/", aiAutomationRoutes)
  .route("/", localTagRoutes)
  .route("/", conversationReferenceRoutes)
  .route("/", automaticReplyRoutes)
  .route("/", mailRuleRoutes)
  .route("/", remoteContentRoutes)
  .route("/", mailboxLifecycleRoutes);
