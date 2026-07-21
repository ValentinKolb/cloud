import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import toolDetailPage from "./[tool]/page";
import helpPage from "./help/page";
import toolsPage from "./page";

export default new Hono<AuthContext>()
  .get("/help", auth.requireRole("*"), ...helpPage)
  .get("/help/:topic", auth.requireRole("*"), ...helpPage)
  .get("/", auth.requireRole("*"), ...toolsPage)
  .get("/:toolId", auth.requireRole("*"), ...toolDetailPage);
