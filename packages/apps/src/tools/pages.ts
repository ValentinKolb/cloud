import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import toolsPage from "./frontend/page";
import toolDetailPage from "./frontend/[tool]/page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("*"), ...toolsPage)
  .get("/:toolId", auth.requireRole("*"), ...toolDetailPage);
