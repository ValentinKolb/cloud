import { type AuthContext, auth, jsonResponse, rateLimit, requiresAdmin, respond, respondMessage, v } from "@valentinkolb/cloud/server";
import { err, fail, ok } from "@valentinkolb/stdlib";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  CreateOAuthClientSchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  OAuthClientSchema,
  OAuthClientWithSecretSchema,
  UpdateOAuthClientSchema,
} from "@/contracts";
import { oauthService } from "../service";

// ==========================
// OAuth Admin API
// ==========================

const OAuthClientListSchema = z.array(OAuthClientSchema);

const getUserBackedActor = (c: Context<AuthContext>) => {
  const actor = c.get("actor");
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

/**
 * Admin routes for managing OAuth clients
 */
const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("admin"))

  // ==========================
  // List Clients
  // ==========================
  .get(
    "/",
    describeRoute({
      tags: ["OAuth Admin"],
      summary: "List OAuth clients",
      description: "List all registered OAuth clients (admin only).",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(OAuthClientListSchema, "List of OAuth clients"),
      },
    }),
    async (c) => {
      const clientsPage = await oauthService.client.list();
      return respond(c, ok(clientsPage.items));
    },
  )

  // ==========================
  // Get Client
  // ==========================
  .get(
    "/:id",
    describeRoute({
      tags: ["OAuth Admin"],
      summary: "Get OAuth client",
      description: "Get details of a specific OAuth client (admin only).",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(OAuthClientSchema, "OAuth client details"),
        404: jsonResponse(ErrorResponseSchema, "Client not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id") ?? "";
      const client = await oauthService.client.get({ id });

      if (!client) {
        return respond(c, fail(err.notFound("Client")));
      }

      return respond(c, ok(client));
    },
  )

  // ==========================
  // Create Client
  // ==========================
  .post(
    "/",
    describeRoute({
      tags: ["OAuth Admin"],
      summary: "Create OAuth client",
      description: "Create a new OAuth client. Returns the client with secret (only shown once).",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(OAuthClientWithSecretSchema, "Created OAuth client with secret"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
      },
    }),
    v("json", CreateOAuthClientSchema),
    async (c) => {
      const data = c.req.valid("json");
      const user = getUserBackedActor(c);
      if (!user) return respond(c, fail(err.forbidden("OAuth client management requires a user-backed actor")));

      const result = await oauthService.client.create({
        data,
        createdBy: user.id,
      });

      return respond(c, result);
    },
  )

  // ==========================
  // Update Client
  // ==========================
  .put(
    "/:id",
    describeRoute({
      tags: ["OAuth Admin"],
      summary: "Update OAuth client",
      description: "Update an existing OAuth client (admin only).",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Client updated"),
        404: jsonResponse(ErrorResponseSchema, "Client not found"),
      },
    }),
    v("json", UpdateOAuthClientSchema),
    async (c) => {
      const id = c.req.param("id") ?? "";
      const data = c.req.valid("json");

      return respondMessage(c, oauthService.client.update({ id, data }), "Client updated");
    },
  )

  // ==========================
  // Delete Client
  // ==========================
  .delete(
    "/:id",
    describeRoute({
      tags: ["OAuth Admin"],
      summary: "Delete OAuth client",
      description: "Delete an OAuth client (admin only).",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Client deleted"),
        404: jsonResponse(ErrorResponseSchema, "Client not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");

      return respondMessage(c, oauthService.client.remove({ id }), "Client deleted");
    },
  )

  // ==========================
  // Regenerate Secret
  // ==========================
  .post(
    "/:id/regenerate-secret",
    describeRoute({
      tags: ["OAuth Admin"],
      summary: "Regenerate client secret",
      description: "Regenerate the client secret for a confidential client (admin only).",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(z.object({ clientSecret: z.string() }), "New client secret"),
        400: jsonResponse(ErrorResponseSchema, "Cannot regenerate for public clients"),
        404: jsonResponse(ErrorResponseSchema, "Client not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");

      return respond(c, oauthService.client.regenerateSecret({ id }));
    },
  );

export default app;
export type ApiType = typeof app;
