import { z } from "zod";

export const NotificationDeliveryStatusSchema = z.enum(["deferred", "pending", "sending", "delivered", "suppressed", "failed"]);
export type NotificationDeliveryStatus = z.infer<typeof NotificationDeliveryStatusSchema>;

export const UserNotificationPreferenceSchema = z.object({
  id: z.string(),
  appId: z.string(),
  kind: z.string(),
  label: z.string(),
  description: z.string(),
  recommendedChannels: z.array(z.string()),
  requiredChannels: z.array(z.string()),
  selectedChannels: z.array(z.string()),
  effectiveChannels: z.array(z.string()),
  customized: z.boolean(),
});
export type UserNotificationPreference = z.infer<typeof UserNotificationPreferenceSchema>;

export const UserNotificationPreferencesResponseSchema = z.object({
  availableChannels: z.array(z.string()),
  definitions: z.array(UserNotificationPreferenceSchema),
});
export type UserNotificationPreferencesResponse = z.infer<typeof UserNotificationPreferencesResponseSchema>;

export const UpdateUserNotificationPreferenceSchema = z.object({
  channels: z.array(z.string().trim().min(1).max(80)).max(20),
});
export type UpdateUserNotificationPreference = z.infer<typeof UpdateUserNotificationPreferenceSchema>;

export const UserNotificationHistoryItemSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  definitionId: z.string(),
  appId: z.string(),
  label: z.string(),
  title: z.string(),
  targetHref: z.string().nullable(),
  channel: z.string(),
  destinationLabel: z.string(),
  required: z.boolean(),
  status: NotificationDeliveryStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  deliveredAt: z.string().datetime().nullable(),
});
export type UserNotificationHistoryItem = z.infer<typeof UserNotificationHistoryItemSchema>;

export const UserNotificationHistoryResponseSchema = z.object({
  items: z.array(UserNotificationHistoryItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type UserNotificationHistoryResponse = z.infer<typeof UserNotificationHistoryResponseSchema>;

export const BrowserPushSubscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(4_000)
    .refine((value) => value.startsWith("https://"), "Push endpoint must use HTTPS"),
  expirationTime: z.number().nonnegative().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(20).max(500),
    auth: z.string().min(8).max(200),
  }),
});
export type BrowserPushSubscription = z.infer<typeof BrowserPushSubscriptionSchema>;

export const BrowserNotificationConfigurationSchema = z.object({ publicKey: z.string().min(1) });
export type BrowserNotificationConfiguration = z.infer<typeof BrowserNotificationConfigurationSchema>;

export const BrowserNotificationEndpointSchema = z.object({ id: z.uuid(), label: z.string() });
export type BrowserNotificationEndpoint = z.infer<typeof BrowserNotificationEndpointSchema>;

export const RegisterBrowserNotificationEndpointSchema = z.object({
  subscription: BrowserPushSubscriptionSchema,
  label: z.string().trim().min(1).max(120).default("This browser"),
});
export type RegisterBrowserNotificationEndpoint = z.infer<typeof RegisterBrowserNotificationEndpointSchema>;
