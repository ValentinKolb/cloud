import { z } from "zod";

export const CreateGroupSchema = z.object({
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
    id: z.string().min(1),
  }),
]);
export type GroupMemberInput = z.infer<typeof GroupMemberInputSchema>;

export const CreateUserSchema = z.object({
  email: z.email(),
  givenname: z.string().min(1),
  sn: z.string().min(1),
  displayName: z.string().optional(),
  autoSendNotification: z.boolean().default(false),
  requestId: z.uuid().optional(),
});
export type CreateUser = z.infer<typeof CreateUserSchema>;

export {
  BaseGroupSchema,
  BaseUserSchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  SearchQuerySchema,
  createPagination,
  hasRole,
  parsePagination,
} from "@valentinkolb/cloud/contracts/shared";
export type {
  BaseGroup,
  BaseUser,
  FullUser,
  GroupMember,
  MutationResult,
  PaginationResponse,
  SessionUser,
} from "@valentinkolb/cloud/contracts/shared";
