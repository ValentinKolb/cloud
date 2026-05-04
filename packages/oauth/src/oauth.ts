import { Hono } from "hono";
import { z } from "zod";
import { describeRoute } from "hono-openapi";
import { v } from "@valentinkolb/cloud/server";
import { jsonResponse } from "@valentinkolb/cloud/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import { oauth } from "./service/oauth";
import { accounts, get } from "@valentinkolb/cloud/services";
import { ErrorResponseSchema, type OAuthScope } from "@/contracts";
import { logger } from "@valentinkolb/cloud/services";

const log = logger("oauth");

const getIssuer = async (): Promise<string> => {
  const appUrl = await get<string>("app.url");
  return appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
};

const OAUTH_SCOPES: OAuthScope[] = ["openid", "profile", "email", "groups"];
const isOAuthScope = (value: string): value is OAuthScope => OAUTH_SCOPES.includes(value as OAuthScope);

/**
 * Decode `Authorization: Basic base64(client_id:client_secret)` into its parts.
 * This is the OAuth `client_secret_basic` method (RFC 6749 §2.3.1). The
 * discovery document advertises it alongside `client_secret_post`, so the
 * token endpoint accepts credentials from either source.
 */
const parseBasicAuth = (header: string | undefined): { clientId: string; clientSecret: string } | null => {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon === -1) return null;
  return {
    clientId: decoded.slice(0, colon),
    clientSecret: decoded.slice(colon + 1),
  };
};

const AuthorizeQuerySchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.url(),
  response_type: z.literal("code"),
  scope: z.string().optional().default("openid"),
  state: z.string().optional(),
  nonce: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.enum(["S256", "plain"]).optional(),
});

const TokenBodySchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  redirect_uri: z.url(),
  // Optional in the schema: client_id may also arrive via
  // `Authorization: Basic` (RFC 6749 §2.3.1). The handler enforces that one
  // source provides it and 400s otherwise.
  client_id: z.string().min(1).optional(),
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
  .get("/.well-known/openid-configuration", async (c) => {
    const issuer = await getIssuer();
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
      const { client_id, redirect_uri, state, nonce, code_challenge, code_challenge_method } = query;

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

        if (!client.allowedProfiles.includes("guest")) {
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

      const user = await accounts.users.get({ id: sessionData.userId });
      if (!user) {
        return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.url)}`);
      }

      if (!client.allowedProfiles.includes(user.profile)) {
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
        nonce,
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
      const basic = parseBasicAuth(c.req.header("Authorization"));
      const client_id = body.client_id ?? basic?.clientId;
      const client_secret = body.client_secret ?? basic?.clientSecret;
      if (!client_id) {
        return c.json({ message: "Missing client_id" }, 400);
      }
      const { code, redirect_uri, code_verifier } = body;

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

      const issuer = await getIssuer();
      try {
        const tokens = await oauth.tokens.createTokens({
          userId: result.userId,
          client: result.client,
          issuer,
          nonce: result.nonce,
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
      const issuer = await getIssuer();

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
