import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { accountsAppService as accountsService } from "@valentinkolb/cloud-core/services";
import { auth, jsonResponse, respond, requiresAuth, v } from "@valentinkolb/cloud-lib/server";
import {
  EntityKindSchema,
  EntityListItemSchema,
  ErrorResponseSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  UserProfileSchema,
  UserProviderSchema,
  createPagination,
  parsePagination,
} from "@valentinkolb/cloud-contracts/shared";

const EntitiesListResponseSchema = z.object({
  items: z.array(EntityListItemSchema),
  pagination: PaginationResponseSchema,
});

const QuerySchema = z
  .object({
    ...PaginationQuerySchema.shape,
    search: z.string().optional(),
    kind: EntityKindSchema.optional(),
    provider: UserProviderSchema.optional(),
    profile: UserProfileSchema.optional(),
    member_of_group_id: z.uuid().optional(),
    manager_of_group_id: z.uuid().optional(),
    parent_group_id: z.uuid().optional(),
    managed_by_user_id: z.uuid().optional(),
    recursive: z.enum(["true", "false"]).optional(),
  })
  .refine((value) => {
    const relationFilters = [
      value.member_of_group_id,
      value.manager_of_group_id,
      value.parent_group_id,
      value.managed_by_user_id,
    ].filter(Boolean);
    return relationFilters.length <= 1;
  }, {
    message: "Only one relation filter can be used at a time.",
    path: ["member_of_group_id"],
  });

const app = new Hono()
  .get(
    "/entities",
    auth.requireRole("user"),
    describeRoute({
      tags: ["Accounts"],
      summary: "List mixed users and groups",
      description: "List users and groups together with SQL-backed filtering, relation scoping, and pagination.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(EntitiesListResponseSchema, "Paginated mixed entity list"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Full account required"),
      },
    }),
    v("query", QuerySchema),
    async (c) => {
      const query = c.req.valid("query");
      const params = parsePagination(query);
      const result = await accountsService.entity.list({
        pagination: { page: params.page, perPage: params.perPage },
        search: query.search,
        kind: query.kind,
        provider: query.provider,
        profile: query.profile,
        memberOfGroupId: query.member_of_group_id,
        managerOfGroupId: query.manager_of_group_id,
        parentGroupId: query.parent_group_id,
        managedByUserId: query.managed_by_user_id,
        recursive: query.recursive === "true",
      });

      return respond(c, {
        ok: true,
        data: {
          items: result.items,
          pagination: createPagination(params, result.total),
        },
      });
    },
  );

export default app;
