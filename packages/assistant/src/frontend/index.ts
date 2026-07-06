import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import allChatsPage from "./chats.page";
import assistantPage from "./page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("authenticated", auth.redirectToLogin), ...assistantPage)
  .get("/chats", auth.requireRole("authenticated", auth.redirectToLogin), ...allChatsPage);
