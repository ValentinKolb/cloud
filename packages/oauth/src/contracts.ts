import { z } from "zod";

export const OAuthScopeSchema = z.enum(["openid", "profile", "email", "groups"]);
export type OAuthScope = z.infer<typeof OAuthScopeSchema>;

export const OAuthAllowedProfileSchema = z.enum(["user", "guest"]);
export type OAuthAllowedProfile = z.infer<typeof OAuthAllowedProfileSchema>;

export const OAuthClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  clientId: z.string(),
  redirectUris: z.array(z.string()),
  logoutUri: z.string().nullable(),
  scopes: z.array(OAuthScopeSchema),
  allowedProfiles: z.array(OAuthAllowedProfileSchema),
  isPublic: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
});

export const OAuthClientWithSecretSchema = OAuthClientSchema.extend({
  clientSecret: z.string(),
});

export const CreateOAuthClientSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  redirectUris: z.array(z.url()).min(1),
  logoutUri: z.url().optional(),
  scopes: z.array(OAuthScopeSchema).default(["openid", "profile", "email"]),
  allowedProfiles: z.array(OAuthAllowedProfileSchema).default(["user", "guest"]),
  isPublic: z.boolean().default(false),
});

export const UpdateOAuthClientSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  redirectUris: z.array(z.url()).min(1).optional(),
  logoutUri: z.url().nullable().optional(),
  scopes: z.array(OAuthScopeSchema).optional(),
  allowedProfiles: z.array(OAuthAllowedProfileSchema).optional(),
});

export type OAuthClient = z.infer<typeof OAuthClientSchema>;
export type OAuthClientWithSecret = z.infer<typeof OAuthClientWithSecretSchema>;
export type CreateOAuthClient = z.infer<typeof CreateOAuthClientSchema>;
export type UpdateOAuthClient = z.infer<typeof UpdateOAuthClientSchema>;

export { ErrorResponseSchema, MessageResponseSchema } from "@valentinkolb/cloud/contracts";
export type { MutationResult } from "@valentinkolb/cloud/contracts";
