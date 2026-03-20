import { z } from "zod";
import { UserProfileSchema, UserProviderSchema } from "@valentinkolb/cloud/contracts/shared";

export const CreateGroupSchema = z.object({
  provider: UserProviderSchema.default("ipa"),
  name: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .toLowerCase()
        .replace(/[_ ]/g, "-")
        .replace(/[^a-z0-9-]/g, ""),
    ),
  description: z.string().optional(),
  posix: z.boolean().optional().default(false),
});

export const UpdateGroupSchema = z.object({
  description: z.string(),
});

export const GroupMemberInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user"),
    id: z.uuid(),
  }),
  z.object({
    type: z.literal("group"),
    id: z.uuid(),
  }),
]);
export type GroupMemberInput = z.infer<typeof GroupMemberInputSchema>;

export const GroupSearchProviderSchema = UserProviderSchema.optional();
export type GroupSearchProvider = z.infer<typeof GroupSearchProviderSchema>;

const CreateUserSharedSchema = {
  email: z.email(),
  givenname: z.string().min(1),
  sn: z.string().min(1),
  displayName: z.string().optional(),
  autoSendNotification: z.boolean().default(false),
  requestId: z.uuid().optional(),
};

export const CreateUserSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("ipa"),
    ...CreateUserSharedSchema,
  }),
  z.object({
    provider: z.literal("local"),
    profile: UserProfileSchema,
    admin: z.boolean().optional().default(false),
    ...CreateUserSharedSchema,
  }).refine((value) => value.profile === "user" || !value.admin, {
    message: "Only local full accounts can be created as admins",
    path: ["admin"],
  }),
]);
export type CreateUser = z.infer<typeof CreateUserSchema>;

export {
  BaseGroupSchema,
  BaseUserSchema,
  EntityKindSchema,
  EntityListItemSchema,
  EntityRelationSchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  SearchQuerySchema,
  UserProfileSchema,
  UserProviderSchema,
  createPagination,
  hasRole,
  parsePagination,
} from "@valentinkolb/cloud/contracts/shared";
export type {
  BaseGroup,
  BaseUser,
  EntityKind,
  EntityListItem,
  EntityRelation,
  GroupMember,
  MutationResult,
  PaginationResponse,
  User,
  UserProfile,
  UserProvider,
} from "@valentinkolb/cloud/contracts/shared";
