import { type AuthContext, auth, jsonResponse, rateLimit, requiresAdmin, respond, respondMessage, v } from "@valentinkolb/cloud/server";
import { err, fail, ok } from "@valentinkolb/stdlib";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  CreateProxyAuthClientSchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  ProxyAuthClientSchema,
  UpdateProxyAuthClientSchema,
} from "@/contracts";
import { proxyAuthService } from "../service";

const ProxyAuthClientListSchema = z.array(ProxyAuthClientSchema);

const getUserBackedActor = (c: Context<AuthContext>) => {
  const actor = c.get("actor");
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("admin"))

  .get(
    "/",
    describeRoute({
      tags: ["Proxy Auth"],
      summary: "List proxy auth clients",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(ProxyAuthClientListSchema, "List of proxy auth clients"),
      },
    }),
    async (c) => {
      const clientsPage = await proxyAuthService.client.list();
      return respond(c, ok(clientsPage.items));
    },
  )

  .get(
    "/:id",
    describeRoute({
      tags: ["Proxy Auth"],
      summary: "Get proxy auth client",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(ProxyAuthClientSchema, "Proxy auth client details"),
        404: jsonResponse(ErrorResponseSchema, "Client not found"),
      },
    }),
    async (c) => {
      const client = await proxyAuthService.client.get({ id: c.req.param("id") });
      if (!client) return respond(c, fail(err.notFound("Client")));
      return respond(c, ok(client));
    },
  )

  .post(
    "/",
    describeRoute({
      tags: ["Proxy Auth"],
      summary: "Create proxy auth client",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(ProxyAuthClientSchema, "Created proxy auth client"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
      },
    }),
    v("json", CreateProxyAuthClientSchema),
    async (c) => {
      const data = c.req.valid("json");
      const user = getUserBackedActor(c);
      if (!user) return respond(c, fail(err.forbidden("Proxy auth client management requires a user-backed actor")));
      return respond(c, proxyAuthService.client.create({ data, createdBy: user.id }));
    },
  )

  .put(
    "/:id",
    describeRoute({
      tags: ["Proxy Auth"],
      summary: "Update proxy auth client",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Client updated"),
        404: jsonResponse(ErrorResponseSchema, "Client not found"),
      },
    }),
    v("json", UpdateProxyAuthClientSchema),
    async (c) => {
      return respondMessage(
        c,
        proxyAuthService.client.update({
          id: c.req.param("id") ?? "",
          data: c.req.valid("json"),
        }),
        "Client updated",
      );
    },
  )

  .delete(
    "/:id",
    describeRoute({
      tags: ["Proxy Auth"],
      summary: "Delete proxy auth client",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Client deleted"),
        404: jsonResponse(ErrorResponseSchema, "Client not found"),
      },
    }),
    async (c) => {
      return respondMessage(c, proxyAuthService.client.remove({ id: c.req.param("id") }), "Client deleted");
    },
  );

export default app;
export type ApiType = typeof app;
