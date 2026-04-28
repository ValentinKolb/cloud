import { z } from "zod";

export const RoleSchema = z.enum([
  "admin",
  "ipa",
  "guest",
  "group-manager",
  "local",
  "user",
  "ipa/user",
  "ipa/guest",
  "local/user",
  "local/guest",
]);
export type Role = z.infer<typeof RoleSchema>;

export const UserProviderSchema = z.enum(["ipa", "local"]);
export type UserProvider = z.infer<typeof UserProviderSchema>;

export const UserProfileSchema = z.enum(["user", "guest"]);
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const SpecialRoleSchema = z.enum(["*", "authenticated", "anonymous"]);
export type SpecialRole = z.infer<typeof SpecialRoleSchema>;
export type RoleOrSpecial = Role | SpecialRole;

export const hasRole = (user: { roles: Role[] }, ...roles: Role[]): boolean => roles.some((role) => user.roles.includes(role));

export const BaseUserSchema = z.object({
  id: z.string(),
  uid: z.string(),
  roles: z.array(RoleSchema),
  provider: UserProviderSchema,
  profile: UserProfileSchema,
  givenname: z.string(),
  sn: z.string(),
  displayName: z.string(),
  mail: z.string().nullable(),
});
export type BaseUser = z.infer<typeof BaseUserSchema>;

export const IpaUserDataSchema = z.object({
  uidNumber: z.number().nullable(),
  phone: z.string().nullable(),
  employeeType: z.string().nullable(),
  mobile: z.string().nullable(),
  address: z.object({
    street: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
  }),
  passwordExpires: z.string().nullable(),
  lastLoginIpa: z.string().nullable(),
  syncedAt: z.string().nullable(),
  sshPublicKeys: z.array(z.string()),
  sshFingerprints: z.array(z.string()),
});
export type IpaUserData = z.infer<typeof IpaUserDataSchema>;

const RichUserFields = {
  accountExpires: z.string().nullable(),
  lastLoginLocal: z.string().nullable(),
  memberofGroup: z.array(z.string()),
  memberofGroupIds: z.array(z.uuid()),
  manages: z.array(z.string()),
  managesGroupIds: z.array(z.uuid()),
} satisfies z.ZodRawShape;

export const IpaUserSchema = BaseUserSchema.extend({
  provider: z.literal("ipa"),
  ipa: IpaUserDataSchema,
  ...RichUserFields,
});
export type IpaUser = z.infer<typeof IpaUserSchema>;

export const LocalUserSchema = BaseUserSchema.extend({
  provider: z.literal("local"),
  ipa: z.null(),
  ...RichUserFields,
});
export type LocalUser = z.infer<typeof LocalUserSchema>;

export const UserSchema = z.discriminatedUnion("provider", [IpaUserSchema, LocalUserSchema]);
export type User = z.infer<typeof UserSchema>;

export const BaseGroupSchema = z.object({
  id: z.uuid(),
  provider: UserProviderSchema,
  name: z.string(),
  description: z.string().nullable(),
  gidnumber: z.number().nullable(),
});
export type BaseGroup = z.infer<typeof BaseGroupSchema>;

export const EntityKindSchema = z.enum(["user", "group"]);
export type EntityKind = z.infer<typeof EntityKindSchema>;

export const EntityRelationSchema = z.object({
  direct: z.boolean().optional(),
});
export type EntityRelation = z.infer<typeof EntityRelationSchema>;

export const EntityListItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    user: BaseUserSchema,
    relation: EntityRelationSchema.optional(),
  }),
  z.object({
    kind: z.literal("group"),
    group: BaseGroupSchema,
    relation: EntityRelationSchema.optional(),
  }),
]);
export type EntityListItem = z.infer<typeof EntityListItemSchema>;

export const GroupMemberSchema = z.object({
  type: z.enum(["user", "group"]),
  id: z.string(),
  displayName: z.string().nullable(),
});
export type GroupMember = z.infer<typeof GroupMemberSchema>;

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
  z.object({ type: z.literal("group"), groupId: z.uuid() }),
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

export const NotebookPresenceParticipantSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  color: z.string(),
  peerCount: z.number().int().positive(),
  joinedAt: z.string(),
});
export type NotebookPresenceParticipant = z.infer<typeof NotebookPresenceParticipantSchema>;

export const GrantAccessSchema = z.object({
  principal: PrincipalSchema,
  permission: PermissionLevelSchema,
});
export type GrantAccess = z.infer<typeof GrantAccessSchema>;

export const UpdateAccessSchema = z.object({
  permission: PermissionLevelSchema,
});
export type UpdateAccess = z.infer<typeof UpdateAccessSchema>;

// ── Settings (browser-safe types) ────────────────────────────────────

export type SettingKind =
  | "string"
  | "text"
  | "email"
  | "url"
  | "secret"
  | "image"
  | "boolean"
  | "number"
  | "enum"
  | "string_list"
  | "number_list"
  | "cron"
  | "timezone"
  | "template";

export type SettingOption = {
  value: string;
  label: string;
};

export type SettingEntry = {
  key: string;
  label: string;
  kind: SettingKind;
  description: string;
  placeholder?: string;
  group: string;
  value: unknown;
  default: unknown;
  isCustom: boolean;
  templateVars?: string[];
  options?: SettingOption[];
  min?: number;
  max?: number;
};
