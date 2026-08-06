import { type AuthContext, expectUserBackedActor } from "@valentinkolb/cloud/server";
import { audit, get } from "@valentinkolb/cloud/services";
import { publicCloudOrigin } from "@valentinkolb/cloud/shared";
import { sql } from "bun";
import type { Context } from "hono";
import { z } from "zod";
import { oauth } from "../service/oauth";

export const ConsentDecisionSchema = z.object({
  request: z.uuid(),
  decision: z.enum(["approve", "deny"]),
});

const localError = (c: Context<AuthContext>, description: string) =>
  c.redirect(`/oauth/error?error=invalid_request&error_description=${encodeURIComponent(description)}`);

const actorForAudit = (user: AuthContext["Variables"]["user"]) => ({
  userId: user.id,
  uid: user.uid,
  provider: user.provider,
  roles: user.roles,
});

const redirectWithDecision = (redirectUri: string, state: string | undefined, params: Record<string, string>): string => {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (state !== undefined) url.searchParams.set("state", state);
  return url.toString();
};

export const completeConsent = async (c: Context<AuthContext>, decisionInput: z.infer<typeof ConsentDecisionSchema>): Promise<Response> => {
  const { request: requestId, decision } = decisionInput;
  const issuer = publicCloudOrigin(await get<string>("app.url"));
  const requestOrigin = c.req.header("origin");
  if (requestOrigin && requestOrigin !== issuer) return localError(c, "Consent request origin is invalid");

  const request = await oauth.consent.consume(requestId);
  const user = expectUserBackedActor(c);
  if (!request || request.userId !== user.id) return localError(c, "Consent request is invalid or expired");

  const client = await oauth.clients.getByClientId({ clientId: request.clientId });
  if (
    !client ||
    client.registrationKind !== "dynamic" ||
    !oauth.clients.validateRedirectUri(client, request.redirectUri) ||
    !oauth.clients.validateResource(client, request.resource, issuer) ||
    request.scopes.some((scope) => !client.scopes.includes(scope)) ||
    !(await oauth.clients.canAuthorizeUser({ client, userId: user.id, profile: user.profile }))
  ) {
    return localError(c, "Consent request is no longer valid");
  }

  if (decision === "deny") {
    await audit.record({
      action: "oauth.dynamic_client.authorize",
      outcome: "denied",
      actor: actorForAudit(user),
      target: { type: "oauth_client", id: client.id, label: client.name },
      reason: "resource_owner_denied",
      metadata: { resource: request.resource, scopes: request.scopes, redirectHost: new URL(request.redirectUri).host },
    });
    return c.redirect(
      redirectWithDecision(request.redirectUri, request.state, {
        error: "access_denied",
        error_description: "The resource owner denied the request",
        iss: issuer,
      }),
    );
  }

  const code = await sql.begin(async (tx) => {
    const createdCode = await oauth.codes.create({
      clientId: client.clientId,
      userId: user.id,
      redirectUri: request.redirectUri,
      scopes: request.scopes,
      resource: request.resource,
      nonce: request.nonce,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: request.codeChallengeMethod,
      db: tx,
    });
    await oauth.clients.markDynamicAuthorized({ id: client.id, db: tx });
    await audit.record(
      {
        action: "oauth.dynamic_client.authorize",
        outcome: "allowed",
        actor: actorForAudit(user),
        target: { type: "oauth_client", id: client.id, label: client.name },
        metadata: { resource: request.resource, scopes: request.scopes, redirectHost: new URL(request.redirectUri).host },
      },
      tx,
    );
    return createdCode;
  });
  return c.redirect(redirectWithDecision(request.redirectUri, request.state, { code, iss: issuer }));
};
