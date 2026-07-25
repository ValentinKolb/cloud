import type { AuthContext } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import automaticReplyRoutes from "./automatic-replies";
import conversationReferenceRoutes from "./conversation-references";
import localTagRoutes from "./local-tags";
import mailboxLifecycleRoutes from "./mailbox-lifecycle";
import remoteContentRoutes from "./remote-content";

export default new Hono<AuthContext>()
  .route("/", localTagRoutes)
  .route("/", conversationReferenceRoutes)
  .route("/", automaticReplyRoutes)
  .route("/", remoteContentRoutes)
  .route("/", mailboxLifecycleRoutes);
