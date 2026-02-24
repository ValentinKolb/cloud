import { z } from "zod";

export const TermsVersionSchema = z.object({
  id: z.uuid(),
  content: z.string(),
  createdAt: z.string(),
});
export type TermsVersion = z.infer<typeof TermsVersionSchema>;

export const CreateTermsSchema = z.object({
  content: z.string().min(1).max(50000),
});
export type CreateTerms = z.infer<typeof CreateTermsSchema>;

export { ErrorResponseSchema } from "@valentinkolb/cloud/contracts/shared";
