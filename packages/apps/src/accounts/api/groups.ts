import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v } from "@valentinkolb/cloud/lib/server";
import { jsonResponse, requiresAdmin, requiresIpa } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { respond } from "@valentinkolb/cloud/lib/server";
import { err, fail, ok } from "@valentinkolb/cloud/lib/server";
import { parsePagination, createPagination } from "@/accounts/contracts";
import {
  PaginationQuerySchema,
  PaginationResponseSchema,
  BaseGroupSchema,
  BaseUserSchema,
  SearchQuerySchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  CreateGroupSchema,
  UpdateGroupSchema,
  GroupMemberInputSchema,
} from "@/accounts/contracts";
import { accountsService } from "../service";

const GroupsListResponseSchema = z.object({
  groups: z.array(BaseGroupSchema),
  pagination: PaginationResponseSchema,
});

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

/** Group management routes. */
const app = new Hono<AuthContext>()
  // Search endpoint — accessible by all IPA users (not just admins)
  .get(
    "/:cn/search",
    auth.requireRole("ipa"),
    describeRoute({
      tags: ["Groups"],
      summary: "Search users/groups for member/manager autocomplete",
      description: "Search users and/or groups with various filters. Available to all IPA users.",
      ...requiresIpa,
      responses: {
        200: jsonResponse(
          z.object({
            users: z.array(BaseUserSchema),
            groups: z.array(BaseGroupSchema),
          }),
          "Search results",
        ),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v(
      "query",
      z.object({
        q: z.string().min(2),
        users: z.enum(["true", "false"]).optional().default("true"),
        groups: z.enum(["true", "false"]).optional().default("false"),
        exclude_user_ids: z.string().optional(),
        exclude_groups: z.string().optional(),
        only_user_groups: z.enum(["true", "false"]).optional().default("false"),
        only_posix_groups: z.enum(["true", "false"]).optional().default("false"),
        users_in_groups: z.string().optional(),
      }),
    ),
    async (c) => {
      const { q, users, groups, exclude_user_ids, exclude_groups, only_user_groups, only_posix_groups, users_in_groups } =
        c.req.valid("query");
      const user = c.get("user");

      const result = await accountsService.group.search({
        query: q,
        includeUsers: users === "true",
        includeGroups: groups === "true",
        excludeUserIds: exclude_user_ids ? exclude_user_ids.split(",") : [],
        excludeGroups: exclude_groups ? exclude_groups.split(",") : [],
        onlyUserGroups: only_user_groups === "true" ? user.memberofGroup : undefined,
        onlyPosixGroups: only_posix_groups === "true",
        usersInGroups: users_in_groups ? users_in_groups.split(",") : undefined,
      });

      return respond(c, ok(result));
    },
  )
  // List groups — accessible by all IPA users
  .get(
    "/",
    auth.requireRole("ipa"),
    describeRoute({
      tags: ["Groups"],
      summary: "List groups",
      description:
        "List FreeIPA groups with pagination and optional search. " +
        "By default, results are scoped to the current user's groups " +
        "(direct memberships and any manage permission, direct or via manager group). " +
        "Set show_all=true to return all groups.",
      ...requiresIpa,
      responses: {
        200: jsonResponse(GroupsListResponseSchema, "Paginated list of groups"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "IPA access required"),
      },
    }),
    v(
      "query",
      z.object({
        ...PaginationQuerySchema.shape,
        ...SearchQuerySchema.shape,
        show_all: z.enum(["true", "false"]).optional().default("false"),
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
          userId: query.show_all === "true" ? undefined : user.id,
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
  // Add/remove members — accessible by IPA users (FreeIPA enforces manager permissions)
  .post(
    "/:cn/members",
    auth.requireRole("ipa"),
    describeRoute({
      tags: ["Groups"],
      summary: "Add member to group",
      description: "Add a user or group as a member. Admins and group managers can perform this action (enforced by FreeIPA).",
      ...requiresIpa,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Member added"),
        400: jsonResponse(ErrorResponseSchema, "Failed to add member"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "IPA access required"),
      },
    }),
    v("json", GroupMemberInputSchema),
    async (c) => {
      const cn = c.req.param("cn");
      const { type, id } = c.req.valid("json");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respond(c, async () => {
        const result = await accountsService.group.member.add({
          ipaSession,
          cn,
          userId: type === "user" ? id : undefined,
          groupCn: type === "group" ? id : undefined,
        });
        if (!result.ok) return result;
        return ok({
          message: `${type === "user" ? "User" : "Group"} "${id}" added as member.`,
        });
      });
    },
  )
  .delete(
    "/:cn/members",
    auth.requireRole("ipa"),
    describeRoute({
      tags: ["Groups"],
      summary: "Remove member from group",
      description: "Remove a user or group member. Admins and group managers can perform this action (enforced by FreeIPA).",
      ...requiresIpa,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Member removed"),
        400: jsonResponse(ErrorResponseSchema, "Failed to remove member"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "IPA access required"),
      },
    }),
    v("json", GroupMemberInputSchema),
    async (c) => {
      const cn = c.req.param("cn");
      const { type, id } = c.req.valid("json");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respond(c, async () => {
        const result = await accountsService.group.member.remove({
          ipaSession,
          cn,
          userId: type === "user" ? id : undefined,
          groupCn: type === "group" ? id : undefined,
        });
        if (!result.ok) return result;
        return ok({
          message: `${type === "user" ? "User" : "Group"} "${id}" removed.`,
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
      const { name, description, posix } = c.req.valid("json");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respond(
        c,
        accountsService.group.create({
          ipaSession,
          name,
          description,
          posix,
        }),
        201,
      );
    },
  )
  .delete(
    "/:cn",
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
      const cn = c.req.param("cn");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respond(c, async () => {
        const result = await accountsService.group.remove({ ipaSession, cn });
        if (!result.ok) return result;
        return ok({ message: `Group '${cn}' deleted.` });
      });
    },
  )
  .patch(
    "/:cn",
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
      const cn = c.req.param("cn");
      const { description } = c.req.valid("json");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respond(c, async () => {
        const result = await accountsService.group.update({
          ipaSession,
          cn,
          description,
        });
        if (!result.ok) return result;
        return ok({ message: `Group '${cn}' updated.` });
      });
    },
  )
  .post(
    "/:cn/make-posix",
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
      const cn = c.req.param("cn");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respond(c, async () => {
        const result = await accountsService.group.makePosix({
          ipaSession,
          cn,
        });
        if (!result.ok) return result;
        return ok({ message: `Group '${cn}' converted to POSIX.` });
      });
    },
  )
  .post(
    "/:cn/managers",
    describeRoute({
      tags: ["Groups"],
      summary: "Add manager to group",
      description: "Add a user or group as a member manager.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Manager added"),
        400: jsonResponse(ErrorResponseSchema, "Failed to add manager"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("json", GroupMemberInputSchema),
    async (c) => {
      const cn = c.req.param("cn");
      const { type, id } = c.req.valid("json");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respond(c, async () => {
        const result = await accountsService.group.manager.add({
          ipaSession,
          cn,
          userId: type === "user" ? id : undefined,
          groupCn: type === "group" ? id : undefined,
        });
        if (!result.ok) return result;
        return ok({
          message: `${type === "user" ? "User" : "Group"} "${id}" added as manager.`,
        });
      });
    },
  )
  .delete(
    "/:cn/managers",
    describeRoute({
      tags: ["Groups"],
      summary: "Remove manager from group",
      description: "Remove a user or group member manager.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Manager removed"),
        400: jsonResponse(ErrorResponseSchema, "Failed to remove manager"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("json", GroupMemberInputSchema),
    async (c) => {
      const cn = c.req.param("cn");
      const { type, id } = c.req.valid("json");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respond(c, async () => {
        const result = await accountsService.group.manager.remove({
          ipaSession,
          cn,
          userId: type === "user" ? id : undefined,
          groupCn: type === "group" ? id : undefined,
        });
        if (!result.ok) return result;
        return ok({
          message: `${type === "user" ? "User" : "Group"} "${id}" removed as manager.`,
        });
      });
    },
  );

export default app;
