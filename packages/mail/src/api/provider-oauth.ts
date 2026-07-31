import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { err, fail } from "@k2b/stdlib";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { mailOAuthStartInputSchema } from "../contracts";
import type { MailRequestContext } from "../service";
import { providerOAuth } from "../service";
import { sha256Text } from "../service/canonical";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const flowParamSchema = z.object({ flowId: z.string().uuid() });
const callbackQuerySchema = z
  .object({
    state: z.string().min(20).max(1_000),
    code: z.string().min(1).max(16_384).optional(),
    error: z.string().max(200).optional(),
  })
  .passthrough();

const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

const requireBrowserSession = (c: Context<AuthContext>) => c.get("actor").kind === "user" && Boolean(c.get("sessionToken"));

const callbackHeaders = (c: Context<AuthContext>) => {
  c.header("cache-control", "no-store");
  c.header("referrer-policy", "no-referrer");
};

export const providerOAuthApi = new Hono<AuthContext>()
  .get("/oauth/providers", async (c) => {
    if (!requireBrowserSession(c)) return respond(c, fail(err.forbidden("Browser OAuth requires an active user session")));
    return c.json(await providerOAuth.listConfiguredOAuthProviders());
  })
  .post("/mailboxes/:mailboxId/oauth/start", v("param", mailboxParamSchema), v("json", mailOAuthStartInputSchema), async (c) => {
    if (!requireBrowserSession(c)) return respond(c, fail(err.forbidden("Browser OAuth requires an active user session")));
    const result = await providerOAuth.startProviderOAuth({
      context: requestContext(c),
      mailboxId: c.req.valid("param").mailboxId,
      input: c.req.valid("json"),
    });
    if (!result.ok) return respond(c, result);
    const callbackUri = await providerOAuth.providerOAuthCallbackUri();
    setCookie(c, result.data.cookieName, result.data.browserNonce, {
      httpOnly: true,
      secure: new URL(callbackUri).protocol === "https:",
      sameSite: "Lax",
      maxAge: 10 * 60,
      path: "/api/mail/oauth/callback",
    });
    return c.json({ authorizationUrl: result.data.authorizationUrl, expiresAt: result.data.expiresAt });
  })
  .get("/oauth/flows/:flowId", v("param", flowParamSchema), async (c) => {
    if (!requireBrowserSession(c)) return respond(c, fail(err.forbidden("Browser OAuth requires an active user session")));
    return respond(c, providerOAuth.getProviderOAuthFlowResult(requestContext(c), c.req.valid("param").flowId));
  })
  .get("/oauth/callback", async (c) => {
    callbackHeaders(c);
    if (!requireBrowserSession(c)) return c.redirect("/app/mail?oauth=failed", 303);
    const query = callbackQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.redirect("/app/mail?oauth=failed", 303);
    const cookieName = `mail_oauth_${sha256Text(query.data.state).slice(0, 20)}`;
    const browserNonce = getCookie(c, cookieName) ?? "";
    deleteCookie(c, cookieName, { path: "/api/mail/oauth/callback" });
    if (!browserNonce) return c.redirect("/app/mail?oauth=failed", 303);
    const result = await providerOAuth.completeProviderOAuth({
      context: requestContext(c),
      state: query.data.state,
      browserNonce,
      code: query.data.code ?? null,
      providerDenied: Boolean(query.data.error),
    });
    const destination = result.mailboxId ? `/app/mail/${result.mailboxId}` : "/app/mail";
    const search = new URLSearchParams({ oauth: result.outcome });
    if (result.flowId) search.set("flow", result.flowId);
    return c.redirect(`${destination}?${search}`, 303);
  });
