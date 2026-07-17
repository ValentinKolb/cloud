import type { AuthContext } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import localTagRoutes from "./local-tags";
import conversationReferenceRoutes from "./conversation-references";
import mailboxLifecycleRoutes from "./mailbox-lifecycle";
import responseScheduleRoutes from "./response-schedules";

export default new Hono<AuthContext>()
  .route("/", localTagRoutes)
  .route("/", conversationReferenceRoutes)
  .route("/", responseScheduleRoutes)
  .route("/", mailboxLifecycleRoutes);
