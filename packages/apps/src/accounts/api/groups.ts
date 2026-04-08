import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { isAdminUser } from "@valentinkolb/cloud/lib/shared";
import { v } from "@valentinkolb/cloud/lib/server";
import { jsonResponse, requiresAdmin, requiresAuth } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { respond } from "@valentinkolb/cloud/lib/server";
import { err, fail, ok } from "@valentinkolb/cloud/lib/server";
import { accountsAppService as accountsService, getFreeIpaConfigSync, providers } from "@valentinkolb/cloud-core/services";
import { parsePagination, createPagination } from "@/accounts/contracts";
import {
  PaginationQuerySchema,
  PaginationResponseSchema,
  BaseGroupSchema,
  SearchQuerySchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  CreateGroupSchema,
  UpdateGroupSchema,
  GroupMemberInputSchema,
} from "@/accounts/contracts";
const GroupsListResponseSchema = z.object({
  groups: z.array(BaseGroupSchema),
  pagination: PaginationResponseSchema,
});

const requireLocalGroupManageAccess = async (
  c: Context<AuthContext>,
  group: NonNullable<Awaited<ReturnType<typeof accountsService.group.get>>>,
) => {
  const user = c.get("user");
  if (isAdminUser(user)) return null;
  if (group.provider !== "local") return null;

  const managedGroups = await accountsService.user.managedGroup.list({
    userId: user.id,
    recursive: true,
  });
  const canManage = managedGroups.items.includes(group.name);
  if (canManage) return null;

  return await respond(c, fail(err.forbidden("Access denied")));
};

const requireActorIpaSession = async (c: Context<AuthContext>) => {
  if (!getFreeIpaConfigSync().enabled) {
    return {
      error: await respond(c, fail(err.badInput("FreeIPA is disabled."))),
    };
  }
  const token = c.get("sessionToken");
  const ipaSession = await auth.session.getIpaSession(token);
  if (ipaSession) return { ipaSession };
  return {
    error: await respond(c, fail(err.unauthenticated("Your FreeIPA session is required for this action."))),
  };
};

const requireAdminIpaSession = async (c: Context<AuthContext>) => {
  if (!getFreeIpaConfigSync().enabled) {
    return {
      error: await respond(c, fail(err.badInput("FreeIPA is disabled."))),
    };
  }
  try {
    return { ipaSession: await providers.ipa.auth.getServiceSession() };
  } catch {
    return {
      error: await respond(c, fail(err.internal("Internal FreeIPA session unavailable."))),
    };
  }
};

const requireGroupMutationContext = async (c: Context<AuthContext>, groupId: string) => {
  const group = await accountsService.group.get({ id: groupId });
  if (!group) {
    return {
      error: await respond(c, fail(err.notFound("Group not found"))),
    };
  }

  const accessError = await requireLocalGroupManageAccess(c, group);
  if (accessError) {
    return {
      error: accessError,
    };
  }

  if (group.provider === "ipa" && !getFreeIpaConfigSync().enabled) {
    return {
      error: await respond(c, fail(err.badInput("FreeIPA is disabled."))),
    };
  }

  if (group.provider === "local") {
    return { group, ipaSession: null };
  }

  const user = c.get("user");
  const sessionResult = isAdminUser(user) ? await requireAdminIpaSession(c) : await requireActorIpaSession(c);
  if ("error" in sessionResult) return { error: sessionResult.error };

  return { group, ipaSession: sessionResult.ipaSession };
};

/** Group management routes. */
const app = new Hono<AuthContext>()
  // List groups — accessible by all full-account users
  .get(
    "/",
    auth.requireRole("user"),
    describeRoute({
      tags: ["Groups"],
      summary: "List groups",
      description:
        "List groups with pagination and optional search. " +
        "Use scope=managed, scope=member, or scope=all to choose the current view.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(GroupsListResponseSchema, "Paginated list of groups"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Full account required"),
      },
    }),
    v(
      "query",
      z.object({
        ...PaginationQuerySchema.shape,
        ...SearchQuerySchema.shape,
        scope: z.enum(["managed", "member", "all"]).optional(),
        show_all: z.enum(["true", "false"]).optional(),
        provider: z.enum(["local", "ipa"]).optional(),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query");
      const params = parsePagination(query);
      const user = c.get("user");

      const groupsPage = await accountsService.group.list({
        pagination: { page: params.page, perPage: params.perPage },
        filter: { search: query.search },
        scope: {
          userId: query.scope === "all" || query.show_all === "true" ? undefined : user.id,
          mode: query.scope ?? (query.show_all === "true" ? "all" : "member"),
          provider: query.provider,
        },
      });

      return respond(
        c,
        ok({
          groups: groupsPage.items,
          pagination: createPagination(params, groupsPage.total),
        }),
      );
    },
  )
  // Add/remove members — accessible by full-account users (backend/provider enforces permissions)
  .post(
    "/:id/members",
    auth.requireRole("user"),
    describeRoute({
      tags: ["Groups"],
      summary: "Add member to group",
      description: "Add a user or group as a member. Admins and group managers can perform this action where allowed.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Member added"),
        400: jsonResponse(ErrorResponseSchema, "Failed to add member"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "IPA access required"),
      },
    }),
    v("json", GroupMemberInputSchema),
    async (c) => {
      const groupId = c.req.param("id");
      const { type, id: memberId } = c.req.valid("json");
      const { group, ipaSession, error } = await requireGroupMutationContext(c, groupId);
      if (error || !group) return error!;

      return respond(c, async () => {
        const result = await accountsService.group.member.add({
          ipaSession,
          id: groupId,
          provider: group.provider,
          userId: type === "user" ? memberId : undefined,
          groupId: type === "group" ? memberId : undefined,
        });
        if (!result.ok) return result;
        return ok({
          message: `${type === "user" ? "User" : "Group"} "${memberId}" added as member.`,
        });
      });
    },
  )
  .delete(
    "/:id/members",
    auth.requireRole("user"),
    describeRoute({
      tags: ["Groups"],
      summary: "Remove member from group",
      description: "Remove a user or group member. Admins and group managers can perform this action where allowed.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Member removed"),
        400: jsonResponse(ErrorResponseSchema, "Failed to remove member"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "IPA access required"),
      },
    }),
    v("json", GroupMemberInputSchema),
    async (c) => {
      const groupId = c.req.param("id");
      const { type, id: memberId } = c.req.valid("json");
      const { group, ipaSession, error } = await requireGroupMutationContext(c, groupId);
      if (error || !group) return error!;

      return respond(c, async () => {
        const result = await accountsService.group.member.remove({
          ipaSession,
          id: groupId,
          provider: group.provider,
          userId: type === "user" ? memberId : undefined,
          groupId: type === "group" ? memberId : undefined,
        });
        if (!result.ok) return result;
        return ok({
          message: `${type === "user" ? "User" : "Group"} "${memberId}" removed.`,
        });
      });
    },
  )
  .post(
    "/:id/managers",
    auth.requireRole("user"),
    describeRoute({
      tags: ["Groups"],
      summary: "Add manager to group",
      description: "Add a user or group as a manager where the current user has permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Manager added"),
        400: jsonResponse(ErrorResponseSchema, "Failed to add manager"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Full account required"),
      },
    }),
    v("json", GroupMemberInputSchema),
    async (c) => {
      const groupId = c.req.param("id");
      const { type, id: managerId } = c.req.valid("json");
      const { group, ipaSession, error } = await requireGroupMutationContext(c, groupId);
      if (error || !group) return error!;

      return respond(c, async () => {
        const result = await accountsService.group.manager.add({
          ipaSession,
          id: groupId,
          provider: group.provider,
          userId: type === "user" ? managerId : undefined,
          groupId: type === "group" ? managerId : undefined,
        });
        if (!result.ok) return result;
        return ok({
          message: `${type === "user" ? "User" : "Group"} "${managerId}" added as manager.`,
        });
      });
    },
  )
  .delete(
    "/:id/managers",
    auth.requireRole("user"),
    describeRoute({
      tags: ["Groups"],
      summary: "Remove manager from group",
      description: "Remove a user or group manager where the current user has permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Manager removed"),
        400: jsonResponse(ErrorResponseSchema, "Failed to remove manager"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Full account required"),
      },
    }),
    v("json", GroupMemberInputSchema),
    async (c) => {
      const groupId = c.req.param("id");
      const { type, id: managerId } = c.req.valid("json");
      const { group, ipaSession, error } = await requireGroupMutationContext(c, groupId);
      if (error || !group) return error!;

      return respond(c, async () => {
        const result = await accountsService.group.manager.remove({
          ipaSession,
          id: groupId,
          provider: group.provider,
          userId: type === "user" ? managerId : undefined,
          groupId: type === "group" ? managerId : undefined,
        });
        if (!result.ok) return result;
        return ok({
          message: `${type === "user" ? "User" : "Group"} "${managerId}" removed as manager.`,
        });
      });
    },
  )
  // All routes below require admin role
  .use(auth.requireRole("admin"))
  .post(
    "/",
    describeRoute({
      tags: ["Groups"],
      summary: "Create group",
      description: "Create a new FreeIPA group. Name is normalized to lowercase with hyphens.",
      ...requiresAdmin,
      responses: {
        201: jsonResponse(BaseGroupSchema, "Group created successfully"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input or group already exists"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v("json", CreateGroupSchema),
    async (c) => {
      const { provider, name, description, posix } = c.req.valid("json");
      const ipaSessionResult = provider === "ipa" ? await requireAdminIpaSession(c) : null;
      if (ipaSessionResult && "error" in ipaSessionResult) return ipaSessionResult.error;

      return respond(
        c,
        accountsService.group.create({
          ipaSession: ipaSessionResult?.ipaSession ?? null,
          provider,
          name,
          description,
          posix,
        }),
        201,
      );
    },
  )
  .delete(
    "/:id",
    describeRoute({
      tags: ["Groups"],
      summary: "Delete group",
      description: "Delete a FreeIPA group by name.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Group deleted successfully"),
        400: jsonResponse(ErrorResponseSchema, "Failed to delete group"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const group = await accountsService.group.get({ id });
      if (!group) return respond(c, fail(err.notFound("Group not found")));
      const ipaSessionResult = group.provider === "ipa" ? await requireAdminIpaSession(c) : null;
      if (ipaSessionResult && "error" in ipaSessionResult) return ipaSessionResult.error;

      return respond(c, async () => {
        const result = await accountsService.group.remove({
          ipaSession: ipaSessionResult?.ipaSession ?? null,
          id,
          provider: group.provider,
        });
        if (!result.ok) return result;
        return ok({ message: "Group deleted." });
      });
    },
  )
  .patch(
    "/:id",
    describeRoute({
      tags: ["Groups"],
      summary: "Update group",
      description: "Update a FreeIPA group's description.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Group updated successfully"),
        400: jsonResponse(ErrorResponseSchema, "Failed to update group"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v("json", UpdateGroupSchema),
    async (c) => {
      const id = c.req.param("id");
      const { description } = c.req.valid("json");
      const group = await accountsService.group.get({ id });
      if (!group) return respond(c, fail(err.notFound("Group not found")));
      const ipaSessionResult = group.provider === "ipa" ? await requireAdminIpaSession(c) : null;
      if (ipaSessionResult && "error" in ipaSessionResult) return ipaSessionResult.error;

      return respond(c, async () => {
        const result = await accountsService.group.update({
          ipaSession: ipaSessionResult?.ipaSession ?? null,
          id,
          provider: group.provider,
          description,
        });
        if (!result.ok) return result;
        return ok({ message: "Group updated." });
      });
    },
  )
  .post(
    "/:id/make-posix",
    describeRoute({
      tags: ["Groups"],
      summary: "Convert group to POSIX",
      description: "Convert a FreeIPA group to a POSIX group (assigns a GID). This cannot be undone.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Group converted to POSIX"),
        400: jsonResponse(ErrorResponseSchema, "Failed to convert group"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const group = await accountsService.group.get({ id });
      if (!group) return respond(c, fail(err.notFound("Group not found")));
      const ipaSessionResult = group.provider === "ipa" ? await requireAdminIpaSession(c) : null;
      if (ipaSessionResult && "error" in ipaSessionResult) return ipaSessionResult.error;

      return respond(c, async () => {
        const result = await accountsService.group.makePosix({
          ipaSession: ipaSessionResult?.ipaSession ?? null,
          id,
          provider: group.provider,
        });
        if (!result.ok) return result;
        return ok({ message: "Group converted to POSIX." });
      });
    },
  )
  ;

export default app;
