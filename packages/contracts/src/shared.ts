import { z } from "zod";

export const RoleSchema = z.enum([
  "admin",
  "ipa",
  "ipa-limited",
  "guest",
  "group-manager",
]);
export type Role = z.infer<typeof RoleSchema>;

export const SpecialRoleSchema = z.enum([
  "*",
  "authenticated",
  "anonymous",
]);
export type SpecialRole = z.infer<typeof SpecialRoleSchema>;
export type RoleOrSpecial = Role | SpecialRole;

export const hasRole = (user: { roles: Role[] }, ...roles: Role[]): boolean => roles.some((role) => user.roles.includes(role));

export const BaseUserSchema = z.object({
  id: z.string(),
  uid: z.string(),
  roles: z.array(RoleSchema),
  givenname: z.string(),
  sn: z.string(),
  displayName: z.string(),
  mail: z.string().nullable(),
});
export type BaseUser = z.infer<typeof BaseUserSchema>;

export const FullUserSchema = BaseUserSchema.extend({
  phone: z.string().nullable(),
  uidNumber: z.number().nullable(),
  ipaAccountExpires: z.string().nullable(),
  ipaPasswordExpires: z.string().nullable(),
  lastLoginIpa: z.string().nullable(),
  lastLoginLocal: z.string().nullable(),
  employeeType: z.string().nullable(),
  address: z.object({
    street: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
  }),
  mobile: z.string().nullable(),
  sshPublicKeys: z.array(z.string()),
  sshFingerprints: z.array(z.string()),
});
export type FullUser = z.infer<typeof FullUserSchema>;

export const SessionUserSchema = FullUserSchema.extend({
  memberofGroup: z.array(z.string()),
  manages: z.array(z.string()),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const BaseGroupSchema = z.object({
  cn: z.string(),
  description: z.string().nullable(),
  gidnumber: z.number().nullable(),
});
export type BaseGroup = z.infer<typeof BaseGroupSchema>;

export const GroupMemberSchema = z.object({
  type: z.enum(["user", "group"]),
  id: z.string(),
  displayName: z.string().nullable(),
});
export type GroupMember = z.infer<typeof GroupMemberSchema>;

export const IpaHostSchema = z.object({
  fqdn: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  locality: z.string().nullable(),
  memberofHostgroup: z.array(z.string()),
  macAddress: z.array(z.string()),
  platform: z.string().nullable(),
  osVersion: z.string().nullable(),
  sshFingerprints: z.array(z.string()),
});
export type IpaHost = z.infer<typeof IpaHostSchema>;

export const IpaHostgroupSchema = z.object({
  cn: z.string(),
  description: z.string().nullable(),
  hosts: z.array(z.string()),
  hostgroups: z.array(z.string()),
});
export type IpaHostgroup = z.infer<typeof IpaHostgroupSchema>;

export const SearchQuerySchema = z.object({
  search: z.string().optional(),
});

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  per_page: z.coerce.number().int().min(1).max(100).optional().default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const PaginationResponseSchema = z.object({
  page: z.number(),
  per_page: z.number(),
  total: z.number(),
  total_pages: z.number(),
  has_next: z.boolean(),
});
export type PaginationResponse = z.infer<typeof PaginationResponseSchema>;

export type PaginationParams = {
  page: number;
  perPage: number;
  offset: number;
};

export const parsePagination = (query: { page?: number; per_page?: number }): PaginationParams => {
  const page = query.page ?? 1;
  const perPage = query.per_page ?? 20;
  const offset = (page - 1) * perPage;
  return { page, perPage, offset };
};

export const createPagination = (params: PaginationParams, total: number): PaginationResponse => {
  const totalPages = Math.ceil(total / params.perPage);
  return {
    page: params.page,
    per_page: params.perPage,
    total,
    total_pages: totalPages,
    has_next: params.page < totalPages,
  };
};

export const ErrorResponseSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const MessageResponseSchema = z.object({
  message: z.string(),
});
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export type MutationResult<T = void> = { ok: true; data: T } | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 409 | 500 };

export const PermissionLevelSchema = z.enum(["none", "read", "write", "admin"]);
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

export const PrincipalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: z.uuid() }),
  z.object({ type: z.literal("group"), groupCn: z.string() }),
  z.object({ type: z.literal("authenticated") }),
  z.object({ type: z.literal("public") }),
]);
export type Principal = z.infer<typeof PrincipalSchema>;

export const AccessEntrySchema = z.object({
  id: z.uuid(),
  principal: PrincipalSchema,
  permission: PermissionLevelSchema,
  createdAt: z.string(),
  displayName: z.string().optional(),
});
export type AccessEntry = z.infer<typeof AccessEntrySchema>;

export const GrantAccessSchema = z.object({
  principal: PrincipalSchema,
  permission: PermissionLevelSchema,
});
export type GrantAccess = z.infer<typeof GrantAccessSchema>;

export const UpdateAccessSchema = z.object({
  permission: PermissionLevelSchema,
});
export type UpdateAccess = z.infer<typeof UpdateAccessSchema>;
