import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import helpPage from "./help/page";
import assistantPage from "./page";

export default new Hono<AuthContext>()
  .get("/help", auth.requireRole("authenticated", auth.redirectToLogin), ...helpPage)
  .get("/help/:topic", auth.requireRole("authenticated", auth.redirectToLogin), ...helpPage)
  .get("/", auth.requireRole("authenticated", auth.redirectToLogin), ...assistantPage)
  .get("/chats", auth.requireRole("authenticated", auth.redirectToLogin), (c) => c.redirect("/app/assistant"));
