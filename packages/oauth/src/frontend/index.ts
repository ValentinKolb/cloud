import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import oauthPage from "./page";
import oauthErrorPage from "./error";
import oauthRoutes from "../oauth";

export default new Hono<AuthContext>()
  .route("/", oauthRoutes)
  .get("/admin/oauth", auth.requireRole("admin", auth.redirectToLogin), ...oauthPage)
  .get("/oauth/error", auth.requireRole("*"), ...oauthErrorPage);
