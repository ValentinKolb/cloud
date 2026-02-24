import { z } from "zod";

export const FaqAudienceSchema = z.enum(["ipa", "ipa-limited", "guest", "anonymous"]);
export type FaqAudience = z.infer<typeof FaqAudienceSchema>;

export const FaqEntrySchema = z.object({
  id: z.uuid(),
  question: z.string(),
  answer: z.string(),
  audience: z.array(FaqAudienceSchema),
  position: z.number().int(),
  createdAt: z.string(),
});
export type FaqEntry = z.infer<typeof FaqEntrySchema>;

export const CreateFaqSchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(5000),
  audience: z.array(FaqAudienceSchema).min(1),
});
export type CreateFaq = z.infer<typeof CreateFaqSchema>;

export const UpdateFaqSchema = z.object({
  question: z.string().min(1).max(500).optional(),
  answer: z.string().min(1).max(5000).optional(),
  audience: z.array(FaqAudienceSchema).min(1).optional(),
});
export type UpdateFaq = z.infer<typeof UpdateFaqSchema>;

export const ReorderFaqSchema = z.object({
  ids: z.array(z.uuid()).min(1),
});
export type ReorderFaq = z.infer<typeof ReorderFaqSchema>;

export { ErrorResponseSchema, MessageResponseSchema, hasRole } from "@valentinkolb/cloud/contracts/shared";
