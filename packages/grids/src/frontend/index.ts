import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import indexPage from "./page";
import baseDetailPage from "./[baseId]/page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...indexPage)
  .get("/:baseId", auth.requireRole("user", auth.redirectToLogin), ...baseDetailPage);
