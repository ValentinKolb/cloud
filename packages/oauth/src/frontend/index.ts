import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import oauthRoutes from "../oauth";
import oauthErrorPage from "./error";
import oauthPage from "./page";

export default new Hono<AuthContext>()
  .route("/", oauthRoutes)
  .get("/admin/oauth", auth.requireRole("admin", auth.redirectToLogin), ...oauthPage)
  .get("/oauth/error", auth.requireRole("*"), ...oauthErrorPage);
