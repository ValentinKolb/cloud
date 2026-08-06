import { type AuthContext, auth, rateLimit, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import oauthRoutes from "../oauth";
import consentPage from "./consent";
import { ConsentDecisionSchema, completeConsent } from "./consent-action";
import oauthErrorPage from "./error";
import oauthPage from "./page";

export default new Hono<AuthContext>()
  .get(
    "/oauth/consent",
    async (c, next) => {
      c.header("Cache-Control", "no-store");
      c.header("Pragma", "no-cache");
      c.header("Content-Security-Policy", "frame-ancestors 'none'");
      c.header("X-Frame-Options", "DENY");
      c.header("Referrer-Policy", "no-referrer");
      await next();
    },
    auth.requireRole("authenticated", auth.redirectToLogin),
    auth.requireUser(auth.redirectToLogin),
    ...consentPage,
  )
  .post("/oauth/consent", rateLimit(), auth.requireRole("authenticated"), auth.requireUser(), v("form", ConsentDecisionSchema), (c) =>
    completeConsent(c, c.req.valid("form")),
  )
  .route("/", oauthRoutes)
  .get("/admin/oauth", auth.requireRole("admin", auth.redirectToLogin), ...oauthPage)
  .get("/oauth/error", auth.requireRole("*"), ...oauthErrorPage);
