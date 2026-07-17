import type { AuthContext } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import localTagRoutes from "./local-tags";
import mailboxLifecycleRoutes from "./mailbox-lifecycle";

export default new Hono<AuthContext>().route("/", localTagRoutes).route("/", mailboxLifecycleRoutes);
