import { z } from "zod";

export const ProxyAuthAllowedGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  provider: z.enum(["ipa", "local"]),
});
export type ProxyAuthAllowedGroup = z.infer<typeof ProxyAuthAllowedGroupSchema>;

export const ProxyAuthClientSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  clientId: z.string(),
  description: z.string().nullable(),
  allowedGroups: z.array(ProxyAuthAllowedGroupSchema),
  createdAt: z.string(),
});
export type ProxyAuthClient = z.infer<typeof ProxyAuthClientSchema>;

export const CreateProxyAuthClientSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  allowedGroupIds: z.array(z.uuid()).min(1),
});
export type CreateProxyAuthClient = z.infer<typeof CreateProxyAuthClientSchema>;

export const UpdateProxyAuthClientSchema = z.object({
  description: z.string().max(500).nullable().optional(),
  allowedGroupIds: z.array(z.uuid()).min(1).optional(),
});
export type UpdateProxyAuthClient = z.infer<typeof UpdateProxyAuthClientSchema>;

export { ErrorResponseSchema, MessageResponseSchema } from "@valentinkolb/cloud/contracts";
