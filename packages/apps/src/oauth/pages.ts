import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import oauthPage from "./frontend/page";
import oauthErrorPage from "./frontend/error";
import oauthRoutes from "./oauth";

export default new Hono<AuthContext>()
  .route("/", oauthRoutes)
  .get("/admin/oauth", auth.requireRole("admin", auth.redirectToLogin), ...oauthPage)
  .get("/oauth/error", auth.requireRole("*"), ...oauthErrorPage);
