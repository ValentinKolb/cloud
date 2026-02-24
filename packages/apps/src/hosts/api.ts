import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v } from "@valentinkolb/cloud/lib/server";
import { jsonResponse } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { rateLimit } from "@valentinkolb/cloud/lib/server";
import { respond } from "@valentinkolb/cloud/lib/server";
import { err, fail, ok, type Result } from "@valentinkolb/cloud/lib/server";
import { hostsService } from "./service";
import { parsePagination, createPagination } from "@/hosts/contracts";
import {
  IpaHostSchema,
  IpaHostgroupSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  SearchQuerySchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  UpdateHostSchema,
  UpdateHostgroupSchema,
} from "@/hosts/contracts";

/**
 * Resolves the active IPA session from auth context and returns an API-ready error when missing.
 */
const requireIpaSession = async (c: Context<AuthContext>) => {
  const token = c.get("sessionToken");
  const ipaSession = await auth.session.getIpaSession(token);

  if (!ipaSession) {
    return {
      ipaSession: null,
      error: await respond(c, fail(err.unauthenticated("IPA session expired"))),
    };
  }

  return { ipaSession };
};

/**
 * Wraps mutation results and returns a standardized message payload for API handlers.
 */
const respondMessage = async (c: Context, resultPromise: Promise<Result<void>>, message: string, successStatus = 200) => {
  return respond(
    c,
    async () => {
      const result = await resultPromise;
      if (!result.ok) return result;
      return ok({ message });
    },
    successStatus,
  );
};

const HostsListResponseSchema = z.object({
  hosts: z.array(IpaHostSchema),
});

const HostgroupsListResponseSchema = z.object({
  hostgroups: z.array(IpaHostgroupSchema),
  pagination: PaginationResponseSchema,
});

/** Host management routes. Admin only. */
const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("admin"))
  .get(
    "/",
    describeRoute({
      tags: ["Hosts"],
      summary: "List all hosts",
      responses: {
        200: jsonResponse(HostsListResponseSchema, "List of all hosts"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    async (c) => {
      const hostsPage = await hostsService.host.list({
        pagination: { perPage: 9999 },
      });
      return respond(c, ok({ hosts: hostsPage.items }));
    },
  )
  .patch(
    "/:fqdn",
    describeRoute({
      tags: ["Hosts"],
      summary: "Update host location/locality",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Host updated"),
        400: jsonResponse(ErrorResponseSchema, "Update failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("json", UpdateHostSchema),
    async (c) => {
      const fqdn = c.req.param("fqdn");
      const data = c.req.valid("json");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respondMessage(c, hostsService.host.update({ ipaSession, fqdn, data }), "Host updated");
    },
  )
  .delete(
    "/:fqdn",
    describeRoute({
      tags: ["Hosts"],
      summary: "Delete a host",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Host deleted"),
        400: jsonResponse(ErrorResponseSchema, "Delete failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    async (c) => {
      const fqdn = c.req.param("fqdn");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respondMessage(c, hostsService.host.remove({ ipaSession, fqdn }), "Host deleted");
    },
  )
  .post(
    "/:fqdn/hostgroups",
    describeRoute({
      tags: ["Hosts"],
      summary: "Add host to a hostgroup",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Host added to group"),
        400: jsonResponse(ErrorResponseSchema, "Failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("json", z.object({ hostgroup: z.string().min(1) })),
    async (c) => {
      const fqdn = c.req.param("fqdn");
      const { hostgroup } = c.req.valid("json");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respondMessage(c, hostsService.host.addToGroup({ ipaSession, fqdn, hostgroup }), "Host added to group");
    },
  )
  .delete(
    "/:fqdn/hostgroups",
    describeRoute({
      tags: ["Hosts"],
      summary: "Remove host from a hostgroup",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Host removed from group"),
        400: jsonResponse(ErrorResponseSchema, "Failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("json", z.object({ hostgroup: z.string().min(1) })),
    async (c) => {
      const fqdn = c.req.param("fqdn");
      const { hostgroup } = c.req.valid("json");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respondMessage(c, hostsService.host.removeFromGroup({ ipaSession, fqdn, hostgroup }), "Host removed from group");
    },
  )
  .get(
    "/hostgroups",
    describeRoute({
      tags: ["Hosts"],
      summary: "List hostgroups",
      description: "List hostgroups with pagination and optional search.",
      responses: {
        200: jsonResponse(HostgroupsListResponseSchema, "Paginated list of hostgroups"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v(
      "query",
      z.object({
        ...PaginationQuerySchema.shape,
        ...SearchQuerySchema.shape,
      }),
    ),
    async (c) => {
      const query = c.req.valid("query");
      const params = parsePagination(query);
      const hostgroupsPage = await hostsService.hostgroup.list({
        pagination: params,
        filter: { query: query.search },
      });
      return respond(
        c,
        ok({
          hostgroups: hostgroupsPage.items,
          pagination: createPagination(params, hostgroupsPage.total),
        }),
      );
    },
  )
  .get(
    "/hostgroups/search",
    describeRoute({
      tags: ["Hosts"],
      summary: "Search hostgroups",
      responses: {
        200: jsonResponse(z.object({ hostgroups: z.array(IpaHostgroupSchema) }), "Search results"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("query", z.object({ q: z.string().min(1), exclude: z.string().optional() })),
    async (c) => {
      const { q, exclude } = c.req.valid("query");
      const hostgroups = await hostsService.hostgroup.search({
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
      tags: ["Hosts"],
      summary: "Create a hostgroup",
      responses: {
        201: jsonResponse(MessageResponseSchema, "Hostgroup created"),
        400: jsonResponse(ErrorResponseSchema, "Failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("json", z.object({ name: z.string().min(1), description: z.string().optional() })),
    async (c) => {
      const { name, description } = c.req.valid("json");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respondMessage(c, hostsService.hostgroup.create({ ipaSession, name, description }), "Hostgroup created", 201);
    },
  )
  .patch(
    "/hostgroups/:cn",
    describeRoute({
      tags: ["Hosts"],
      summary: "Update a hostgroup",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Hostgroup updated"),
        400: jsonResponse(ErrorResponseSchema, "Update failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("json", UpdateHostgroupSchema),
    async (c) => {
      const cn = c.req.param("cn");
      const data = c.req.valid("json");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respondMessage(c, hostsService.hostgroup.update({ ipaSession, cn, data }), "Hostgroup updated");
    },
  )
  .delete(
    "/hostgroups/:cn",
    describeRoute({
      tags: ["Hosts"],
      summary: "Delete a hostgroup",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Hostgroup deleted"),
        400: jsonResponse(ErrorResponseSchema, "Failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    async (c) => {
      const cn = c.req.param("cn");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respondMessage(c, hostsService.hostgroup.remove({ ipaSession, cn }), "Hostgroup deleted");
    },
  );

export default app;
export type ApiType = typeof app;
