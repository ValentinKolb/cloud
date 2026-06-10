import { type AuthContext, auth, jsonResponse, rateLimit, respond, v } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  createPagination,
  ErrorResponseSchema,
  IpaHostgroupSchema,
  IpaHostSchema,
  MessageResponseSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  parsePagination,
  SearchQuerySchema,
  SyncCronResponseSchema,
  UpdateHostgroupSchema,
  UpdateHostSchema,
} from "@/contracts";
import { ipaHostsService } from "../service";

const toAccountsActor = (actor: AuthContext["Variables"]["user"]) => ({
  userId: actor.id,
  uid: actor.uid,
  roles: actor.roles,
  provider: actor.provider,
});

type IpaHostsApiActor = ReturnType<typeof toAccountsActor>;

const getUserBackedActor = (c: Context<AuthContext>) => {
  const actor = c.get("actor");
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

const requireUserBackedApiActor = (c: Context<AuthContext>): Result<IpaHostsApiActor> => {
  const actor = getUserBackedActor(c);
  if (!actor) return fail(err.forbidden("IPA Hosts API requires a user-backed admin actor"));
  return ok(toAccountsActor(actor));
};

const isServiceResult = (value: unknown): value is Result<unknown> => {
  return Boolean(value && typeof value === "object" && "ok" in value);
};

const respondMessage = async (
  c: Context,
  resultPromise: Promise<Result<unknown> | void>,
  message: string,
  successStatus: 200 | 201 = 200,
) => {
  return respond(
    c,
    async () => {
      const result = await resultPromise;
      if (isServiceResult(result) && !result.ok) return result;
      return ok({ message });
    },
    successStatus,
  );
};

const HostsListResponseSchema = z.object({
  hosts: z.array(IpaHostSchema),
  pagination: PaginationResponseSchema,
});
const HostgroupsListResponseSchema = z.object({
  hostgroups: z.array(IpaHostgroupSchema),
  pagination: PaginationResponseSchema,
});

// Mounted at `/api/ipa-hosts`. Sub-routes:
//   /api/ipa-hosts/widget/*  — dashboard widget endpoints (own auth)
//   /api/ipa-hosts/...       — admin api (auth.requireRole("admin"))
import widgetRoutes from "./widgets";

const app = new Hono<AuthContext>()
  .route("/widget", widgetRoutes)
  .use(rateLimit())
  .use(auth.requireRole("admin"))
  .get(
    "/",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "List all hosts",
      responses: {
        200: jsonResponse(HostsListResponseSchema, "Paginated list of hosts"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("query", z.object({ ...PaginationQuerySchema.shape, ...SearchQuerySchema.shape })),
    async (c) => {
      const query = c.req.valid("query");
      const pagination = parsePagination(query);
      const hostsPage = await ipaHostsService.host.list({
        pagination,
        filter: { query: query.search },
      });
      return respond(c, ok({ hosts: hostsPage.items, pagination: createPagination(pagination, hostsPage.total) }));
    },
  )
  .patch(
    "/:fqdn",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "Update host metadata",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Host updated"),
        400: jsonResponse(ErrorResponseSchema, "Update failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        500: jsonResponse(ErrorResponseSchema, "FreeIPA service account unavailable"),
      },
    }),
    v("json", UpdateHostSchema),
    async (c) => {
      const fqdn = c.req.param("fqdn");
      if (!fqdn) return respond(c, fail(err.badInput("Missing host FQDN")));
      const data = c.req.valid("json");
      const actor = requireUserBackedApiActor(c);
      if (!actor.ok) return respond(c, actor);
      return respondMessage(c, ipaHostsService.host.update({ actor: actor.data, fqdn, data }), "Host updated");
    },
  )
  .delete(
    "/:fqdn",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "Delete a host",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Host deleted"),
        400: jsonResponse(ErrorResponseSchema, "Delete failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        500: jsonResponse(ErrorResponseSchema, "FreeIPA service account unavailable"),
      },
    }),
    async (c) => {
      const fqdn = c.req.param("fqdn");
      const actor = requireUserBackedApiActor(c);
      if (!actor.ok) return respond(c, actor);
      return respondMessage(c, ipaHostsService.host.remove({ actor: actor.data, fqdn }), "Host deleted");
    },
  )
  .post(
    "/:fqdn/hostgroups",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "Add host to hostgroup",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Host added to group"),
        400: jsonResponse(ErrorResponseSchema, "Failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        500: jsonResponse(ErrorResponseSchema, "FreeIPA service account unavailable"),
      },
    }),
    v("json", z.object({ hostgroup: z.string().min(1) })),
    async (c) => {
      const fqdn = c.req.param("fqdn");
      if (!fqdn) return respond(c, fail(err.badInput("Missing host FQDN")));
      const { hostgroup } = c.req.valid("json");
      const actor = requireUserBackedApiActor(c);
      if (!actor.ok) return respond(c, actor);
      return respondMessage(c, ipaHostsService.host.addToGroup({ actor: actor.data, fqdn, hostgroup }), "Host added to group");
    },
  )
  .delete(
    "/:fqdn/hostgroups",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "Remove host from hostgroup",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Host removed from group"),
        400: jsonResponse(ErrorResponseSchema, "Failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        500: jsonResponse(ErrorResponseSchema, "FreeIPA service account unavailable"),
      },
    }),
    v("json", z.object({ hostgroup: z.string().min(1) })),
    async (c) => {
      const fqdn = c.req.param("fqdn");
      if (!fqdn) return respond(c, fail(err.badInput("Missing host FQDN")));
      const { hostgroup } = c.req.valid("json");
      const actor = requireUserBackedApiActor(c);
      if (!actor.ok) return respond(c, actor);
      return respondMessage(c, ipaHostsService.host.removeFromGroup({ actor: actor.data, fqdn, hostgroup }), "Host removed from group");
    },
  )
  .get(
    "/hostgroups",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "List hostgroups",
      responses: {
        200: jsonResponse(HostgroupsListResponseSchema, "Paginated list of hostgroups"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("query", z.object({ ...PaginationQuerySchema.shape, ...SearchQuerySchema.shape })),
    async (c) => {
      const query = c.req.valid("query");
      const params = parsePagination(query);
      const hostgroupsPage = await ipaHostsService.hostgroup.list({
        pagination: params,
        filter: { query: query.search },
      });
      return respond(c, ok({ hostgroups: hostgroupsPage.items, pagination: createPagination(params, hostgroupsPage.total) }));
    },
  )
  .get(
    "/hostgroups/search",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "Search hostgroups",
      responses: {
        200: jsonResponse(z.object({ hostgroups: z.array(IpaHostgroupSchema) }), "Search results"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("query", z.object({ q: z.string().min(1), exclude: z.string().optional() })),
    async (c) => {
      const { q, exclude } = c.req.valid("query");
      const hostgroups = await ipaHostsService.hostgroup.search({
        query: q,
        exclude: exclude ? exclude.split(",") : [],
        limit: 10,
      });
      return respond(c, ok({ hostgroups }));
    },
  )
  .post(
    "/hostgroups",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "Create hostgroup",
      responses: {
        201: jsonResponse(MessageResponseSchema, "Hostgroup created"),
        400: jsonResponse(ErrorResponseSchema, "Create failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        500: jsonResponse(ErrorResponseSchema, "FreeIPA service account unavailable"),
      },
    }),
    v("json", z.object({ name: z.string().min(1), description: z.string().optional() })),
    async (c) => {
      const { name, description } = c.req.valid("json");
      const actor = requireUserBackedApiActor(c);
      if (!actor.ok) return respond(c, actor);
      return respondMessage(c, ipaHostsService.hostgroup.create({ actor: actor.data, name, description }), "Hostgroup created", 201);
    },
  )
  .patch(
    "/hostgroups/:cn",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "Update hostgroup",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Hostgroup updated"),
        400: jsonResponse(ErrorResponseSchema, "Update failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        500: jsonResponse(ErrorResponseSchema, "FreeIPA service account unavailable"),
      },
    }),
    v("json", UpdateHostgroupSchema),
    async (c) => {
      const cn = c.req.param("cn");
      if (!cn) return respond(c, fail(err.badInput("Missing hostgroup name")));
      const data = c.req.valid("json");
      const actor = requireUserBackedApiActor(c);
      if (!actor.ok) return respond(c, actor);
      return respondMessage(c, ipaHostsService.hostgroup.update({ actor: actor.data, cn, data }), "Hostgroup updated");
    },
  )
  .delete(
    "/hostgroups/:cn",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "Delete hostgroup",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Hostgroup deleted"),
        400: jsonResponse(ErrorResponseSchema, "Delete failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        500: jsonResponse(ErrorResponseSchema, "FreeIPA service account unavailable"),
      },
    }),
    async (c) => {
      const cn = c.req.param("cn");
      const actor = requireUserBackedApiActor(c);
      if (!actor.ok) return respond(c, actor);
      return respondMessage(c, ipaHostsService.hostgroup.remove({ actor: actor.data, cn }), "Hostgroup deleted");
    },
  )
  .get(
    "/settings/sync-cron",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "Get sync cron",
      responses: {
        200: jsonResponse(SyncCronResponseSchema, "Current sync cron"),
      },
    }),
    async (c) => {
      const [cron, timezone] = await Promise.all([ipaHostsService.sync.getCron(), ipaHostsService.sync.getTimezone()]);
      return respond(c, ok({ cron, timezone }));
    },
  )
  .put(
    "/settings/sync-cron",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "Update sync cron",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Sync cron updated"),
        400: jsonResponse(ErrorResponseSchema, "Invalid cron"),
        500: jsonResponse(ErrorResponseSchema, "Failed to update sync cron"),
      },
    }),
    v("json", z.object({ cron: z.string().min(1) })),
    async (c) => {
      const { cron } = c.req.valid("json");
      return respondMessage(c, ipaHostsService.sync.updateCron({ cron }), "Sync schedule updated");
    },
  )
  .post(
    "/sync",
    describeRoute({
      tags: ["IPA Hosts"],
      summary: "Trigger host sync",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Sync started"),
        500: jsonResponse(ErrorResponseSchema, "Failed to start sync"),
      },
    }),
    async (c) => {
      return respond(c, async () => {
        await ipaHostsService.sync.run();
        return ok({ message: "Sync started" });
      });
    },
  );

export default app;
export type ApiType = typeof app;
