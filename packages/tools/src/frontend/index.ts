import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import toolDetailPage from "./[tool]/page";
import toolsPage from "./page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("*"), ...toolsPage)
  .get("/:toolId", auth.requireRole("*"), ...toolDetailPage);
