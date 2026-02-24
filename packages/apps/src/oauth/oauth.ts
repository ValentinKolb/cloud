import { Hono } from "hono";
import { z } from "zod";
import { describeRoute } from "hono-openapi";
import { v } from "@valentinkolb/cloud/lib/server";
import { jsonResponse } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { env } from "@valentinkolb/cloud/core/config";
import { oauth } from "./service/oauth";
import { ipa } from "@valentinkolb/cloud/core/services";
import { ErrorResponseSchema, type OAuthScope } from "@/oauth/contracts";
import { logger } from "@valentinkolb/cloud/core/services";

const log = logger("oauth");

const getIssuer = () => {
  const appUrl = env.APP_URL;
  return appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
};

const OAUTH_SCOPES: OAuthScope[] = ["openid", "profile", "email", "groups"];
const isOAuthScope = (value: string): value is OAuthScope => OAUTH_SCOPES.includes(value as OAuthScope);

const AuthorizeQuerySchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.url(),
  response_type: z.literal("code"),
  scope: z.string().optional().default("openid"),
  state: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.enum(["S256", "plain"]).optional(),
});

const TokenBodySchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  redirect_uri: z.url(),
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
  code_verifier: z.string().optional(),
});

const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number(),
  id_token: z.string().nullable(),
  scope: z.string(),
});

/** OAuth 2.0 / OpenID Connect routes mounted at root-level standard paths. */
const app = new Hono<AuthContext>()
  .get("/.well-known/openid-configuration", (c) => {
    const issuer = getIssuer();
    return c.json(oauth.tokens.getOpenIdConfiguration(issuer));
  })
  .get("/.well-known/jwks.json", async (c) => {
    try {
      const jwks = await oauth.tokens.getJwks();
      return c.json(jwks);
    } catch (err) {
      log.error("Failed to get JWKS", {
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          message: "Failed to generate JWKS. Please contact an administrator.",
        },
        500,
      );
    }
  })
  .get(
    "/oauth/authorize",
    describeRoute({
      tags: ["OAuth"],
      summary: "Authorization endpoint",
      description: "Initiates the OAuth 2.0 authorization code flow. Redirects to login if not authenticated.",
      responses: {
        302: { description: "Redirect to client or login" },
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
      },
    }),
    v("query", AuthorizeQuerySchema),
    async (c) => {
      const query = c.req.valid("query");
      const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = query;

      const client = await oauth.clients.getByClientId({ clientId: client_id });
      if (!client) {
        return c.json({ message: "Invalid client_id" }, 400);
      }

      if (!oauth.clients.validateRedirectUri(client, redirect_uri)) {
        return c.json({ message: "Invalid redirect_uri" }, 400);
      }

      if (client.isPublic && !code_challenge) {
        return c.json({ message: "PKCE required for public clients" }, 400);
      }

      const token = auth.session.getToken(c);

      const buildLoginRedirect = () => {
        const returnUrl = c.req.url;
        const loginParams = new URLSearchParams();
        loginParams.set("redirectTo", returnUrl);

        if (!client.allowedRoles.includes("guest")) {
          loginParams.set("hide", "guest");
          loginParams.set("method", "ipa");
        }

        return `/auth/login?${loginParams.toString()}`;
      };

      if (!token) {
        return c.redirect(buildLoginRedirect());
      }

      const sessionData = await auth.session.getData(token);
      if (!sessionData) {
        return c.redirect(buildLoginRedirect());
      }

      const user = await ipa.users.get({ id: sessionData.userId });
      if (!user) {
        return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.url)}`);
      }

      if (!client.allowedRoles.some((role) => user.roles.includes(role))) {
        return c.redirect(
          `/oauth/error?error=access_denied&error_description=${encodeURIComponent(
            "You do not have access to this application",
          )}&client_name=${encodeURIComponent(client.name)}`,
        );
      }

      const code = await oauth.codes.create({
        clientId: client.clientId,
        userId: user.id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
      });

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (state) {
        redirectUrl.searchParams.set("state", state);
      }

      return c.redirect(redirectUrl.toString());
    },
  )
  .post(
    "/oauth/token",
    describeRoute({
      tags: ["OAuth"],
      summary: "Token endpoint",
      description: "Exchange authorization code for access token and optionally id_token.",
      responses: {
        200: jsonResponse(TokenResponseSchema, "Token response"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        401: jsonResponse(ErrorResponseSchema, "Invalid credentials"),
      },
    }),
    v("form", TokenBodySchema),
    async (c) => {
      const body = c.req.valid("form");
      const { code, redirect_uri, client_id, client_secret, code_verifier } = body;

      const client = await oauth.clients.validateCredentials({
        clientId: client_id,
        clientSecret: client_secret,
      });

      if (!client) {
        return c.json({ message: "Invalid client credentials" }, 401);
      }

      const result = await oauth.codes.consume({
        code,
        clientId: client_id,
        redirectUri: redirect_uri,
        codeVerifier: code_verifier,
      });

      if (!result) {
        return c.json({ message: "Invalid or expired authorization code" }, 400);
      }

      const issuer = getIssuer();
      try {
        const tokens = await oauth.tokens.createTokens({
          userId: result.userId,
          client: result.client,
          issuer,
        });

        return c.json({
          access_token: tokens.accessToken,
          token_type: "Bearer" as const,
          expires_in: tokens.expiresIn,
          id_token: tokens.idToken,
          scope: result.client.scopes.join(" "),
        });
      } catch (err) {
        log.error("Failed to generate tokens", {
          error: err instanceof Error ? err.message : String(err),
          clientId: client_id,
          userId: result.userId,
        });
        return c.json(
          {
            message: "Token generation failed. Please try again or contact an administrator.",
          },
          500,
        );
      }
    },
  )
  .get(
    "/oauth/userinfo",
    describeRoute({
      tags: ["OAuth"],
      summary: "UserInfo endpoint",
      description: "Returns claims about the authenticated user.",
      responses: {
        200: { description: "User claims" },
        401: jsonResponse(ErrorResponseSchema, "Invalid token"),
      },
    }),
    async (c) => {
      const authHeader = c.req.header("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return c.json({ message: "Missing bearer token" }, 401);
      }

      const token = authHeader.substring(7);
      const issuer = getIssuer();

      try {
        const payload = await oauth.tokens.verifyAccessToken({ token, issuer });
        if (!payload) {
          return c.json({ message: "Invalid token" }, 401);
        }
        if (typeof payload.sub !== "string" || payload.sub.length === 0) {
          return c.json({ message: "Invalid token" }, 401);
        }

        const scopes =
          typeof payload.scope === "string"
            ? payload.scope
                .split(" ")
                .map((scope) => scope.trim())
                .filter((scope) => scope.length > 0)
                .filter(isOAuthScope)
            : ["openid" as const];

        const userInfo = await oauth.tokens.createUserInfo({
          sub: payload.sub,
          scopes,
        });

        if (!userInfo) {
          return c.json({ message: "User not found" }, 401);
        }

        return c.json(userInfo);
      } catch (err) {
        log.error("Failed to process userinfo request", {
          error: err instanceof Error ? err.message : String(err),
        });
        return c.json({ message: "Invalid token" }, 401);
      }
    },
  )
  .get(
    "/oauth/logout",
    describeRoute({
      tags: ["OAuth"],
      summary: "Logout endpoint",
      description: "Logs out the current user and optionally redirects to client logout URI.",
      responses: {
        302: { description: "Redirect after logout" },
      },
    }),
    auth.requireRole("*"),
    async (c) => {
      auth.session.delete(c);

      const postLogoutRedirectUri = c.req.query("post_logout_redirect_uri");
      const clientId = c.req.query("client_id");

      if (postLogoutRedirectUri && clientId) {
        const client = await oauth.clients.getByClientId({ clientId });
        if (client && client.logoutUri === postLogoutRedirectUri) {
          return c.redirect(postLogoutRedirectUri);
        }
      }

      return c.redirect("/");
    },
  );

export default app;
