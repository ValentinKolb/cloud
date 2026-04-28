import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import toolsPage from "./page";
import toolDetailPage from "./[tool]/page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("*"), ...toolsPage)
  .get("/:toolId", auth.requireRole("*"), ...toolDetailPage);
