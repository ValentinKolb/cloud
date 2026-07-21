import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import oauthRoutes from "../oauth";
import oauthErrorPage from "./error";
import helpPage from "./help/page";
import oauthPage from "./page";

export default new Hono<AuthContext>()
  .get("/admin/oauth/help", auth.requireRole("admin", auth.redirectToLogin), ...helpPage)
  .get("/admin/oauth/help/:topic", auth.requireRole("admin", auth.redirectToLogin), ...helpPage)
  .route("/", oauthRoutes)
  .get("/admin/oauth", auth.requireRole("admin", auth.redirectToLogin), ...oauthPage)
  .get("/oauth/error", auth.requireRole("*"), ...oauthErrorPage);
