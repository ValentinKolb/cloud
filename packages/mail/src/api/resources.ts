import { Hono } from "hono";
import automaticReplyRoutes from "./automatic-replies";
import conversationReferenceRoutes from "./conversation-references";
import incomingAutomationRoutes from "./incoming-automations";
import localTagRoutes from "./local-tags";
import mailboxLifecycleRoutes from "./mailbox-lifecycle";
import { type MailApiContext, resolveMailboxParam } from "./public-resource-boundary";
import remoteContentRoutes from "./remote-content";

export default new Hono<MailApiContext>()
  .use("/mailboxes/:mailboxId/*", resolveMailboxParam)
  .route("/", incomingAutomationRoutes)
  .route("/", localTagRoutes)
  .route("/", conversationReferenceRoutes)
  .route("/", automaticReplyRoutes)
  .route("/", remoteContentRoutes)
  .route("/", mailboxLifecycleRoutes);
