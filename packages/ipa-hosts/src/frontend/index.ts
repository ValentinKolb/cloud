import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import helpPage from "./help/page";
import hostsPage from "./page";

export default new Hono<AuthContext>()
  .get("/help", auth.requireRole("admin", auth.redirectToLogin), ...helpPage)
  .get("/help/:topic", auth.requireRole("admin", auth.redirectToLogin), ...helpPage)
  .get("/", auth.requireRole("admin", auth.redirectToLogin), ...hostsPage);
