import { z } from "zod";

const MAX_URL_LENGTH = 2_000;
const MAX_TEXT_LENGTH = 1_000;
const MAX_NAME_LENGTH = 120;
const MAX_ARRAY_ITEMS = 50;

const UrlSchema = z.string().trim().max(MAX_URL_LENGTH).pipe(z.url());
const TextSchema = z.string().trim().max(MAX_TEXT_LENGTH);
const NameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);
const AudienceSchema = z.string().trim().min(1).max(255);
const dedupe = <T>(values: T[]): T[] => Array.from(new Set(values));

export const OAuthScopeSchema = z.enum(["openid", "profile", "email", "groups", "offline_access", "read", "write", "admin"]);
export type OAuthScope = z.infer<typeof OAuthScopeSchema>;

export const OAuthAllowedProfileSchema = z.enum(["user", "guest"]);
export type OAuthAllowedProfile = z.infer<typeof OAuthAllowedProfileSchema>;

export const OAuthAccessModeSchema = z.enum(["profiles", "specific"]);
export type OAuthAccessMode = z.infer<typeof OAuthAccessModeSchema>;

const AllowedProfilesSchema = z
  .array(OAuthAllowedProfileSchema)
  .max(MAX_ARRAY_ITEMS)
  .transform(dedupe)
  .refine((values) => values.length <= 2, "Allowed profiles must not contain more than two distinct values");
const IdListSchema = z.array(z.uuid()).max(MAX_ARRAY_ITEMS).transform(dedupe);

export const OAuthAccessUserSchema = z.object({
  id: z.uuid(),
  uid: z.string(),
  displayName: z.string(),
  mail: z.string().nullable(),
  provider: z.enum(["ipa", "local"]),
});

export const OAuthAccessGroupSchema = z.object({
  id: z.uuid(),
  provider: z.enum(["ipa", "local"]),
  name: z.string(),
  description: z.string().nullable(),
});

export const OAuthClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  clientId: z.string(),
  redirectUris: z.array(z.string()),
  logoutUri: z.string().nullable(),
  scopes: z.array(OAuthScopeSchema),
  audiences: z.array(z.string()),
  serviceAccountId: z.uuid().nullable(),
  allowedProfiles: z.array(OAuthAllowedProfileSchema),
  accessMode: OAuthAccessModeSchema,
  accessUsers: z.array(OAuthAccessUserSchema),
  accessGroups: z.array(OAuthAccessGroupSchema),
  isPublic: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
});

export const OAuthClientWithSecretSchema = OAuthClientSchema.extend({
  clientSecret: z.string(),
});

export const OAuthClientParamSchema = z.object({
  id: z.uuid(),
});

export const CreateOAuthClientSchema = z.object({
  name: NameSchema,
  description: TextSchema.optional(),
  redirectUris: z.array(UrlSchema).max(MAX_ARRAY_ITEMS).transform(dedupe).default([]),
  logoutUri: UrlSchema.optional(),
  scopes: z.array(OAuthScopeSchema).max(MAX_ARRAY_ITEMS).transform(dedupe).default(["openid", "profile", "email"]),
  audiences: z.array(AudienceSchema).max(MAX_ARRAY_ITEMS).transform(dedupe).default(["cloud"]),
  serviceAccountId: z.uuid().nullable().optional(),
  allowedProfiles: AllowedProfilesSchema.default(["user", "guest"]),
  accessMode: OAuthAccessModeSchema.default("profiles"),
  allowedUserIds: IdListSchema.default([]),
  allowedGroupIds: IdListSchema.default([]),
  isPublic: z.boolean().default(false),
});

export const UpdateOAuthClientSchema = z.object({
  name: NameSchema.optional(),
  description: TextSchema.nullable().optional(),
  redirectUris: z.array(UrlSchema).max(MAX_ARRAY_ITEMS).transform(dedupe).optional(),
  logoutUri: UrlSchema.nullable().optional(),
  scopes: z.array(OAuthScopeSchema).max(MAX_ARRAY_ITEMS).transform(dedupe).optional(),
  audiences: z.array(AudienceSchema).max(MAX_ARRAY_ITEMS).transform(dedupe).optional(),
  serviceAccountId: z.uuid().nullable().optional(),
  allowedProfiles: AllowedProfilesSchema.optional(),
  accessMode: OAuthAccessModeSchema.optional(),
  allowedUserIds: IdListSchema.optional(),
  allowedGroupIds: IdListSchema.optional(),
});

export type OAuthClient = z.infer<typeof OAuthClientSchema>;
export type OAuthClientWithSecret = z.infer<typeof OAuthClientWithSecretSchema>;
export type OAuthAccessUser = z.infer<typeof OAuthAccessUserSchema>;
export type OAuthAccessGroup = z.infer<typeof OAuthAccessGroupSchema>;
export type CreateOAuthClient = z.infer<typeof CreateOAuthClientSchema>;
export type UpdateOAuthClient = z.infer<typeof UpdateOAuthClientSchema>;

export type { MutationResult } from "@valentinkolb/cloud/contracts";
export { ErrorResponseSchema, MessageResponseSchema } from "@valentinkolb/cloud/contracts";
