import { z } from "zod";

export const mailSecurityPolicyDispositionSchema = z.enum(["deny", "trust"]);
export const mailSecurityPolicyTargetSchema = z.enum(["sender_address", "sender_domain", "link_domain"]);
export const mailSecurityReportStatusSchema = z.enum(["new", "in_review", "confirmed", "dismissed"]);
export const mailSecurityRiskSchema = z.enum(["none", "warning", "danger"]);

export const mailSecurityFindingSchema = z.object({
  code: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  explanation: z.string().min(1).max(500),
});
export type MailSecurityFinding = z.infer<typeof mailSecurityFindingSchema>;

export const mailSecurityAssessmentSchema = z.object({
  risk: mailSecurityRiskSchema,
  verdict: z.enum(["clear", "suspicious", "quarantined"]),
  findings: z.array(mailSecurityFindingSchema).max(12),
  linksDisabled: z.boolean(),
  evaluatedAt: z.string().datetime(),
});
export type MailSecurityAssessment = z.infer<typeof mailSecurityAssessmentSchema>;

export const mailSecurityPolicySchema = z.object({
  id: z.string().uuid(),
  disposition: mailSecurityPolicyDispositionSchema,
  target: mailSecurityPolicyTargetSchema,
  value: z.string(),
  note: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MailSecurityPolicy = z.infer<typeof mailSecurityPolicySchema>;

export const createMailSecurityPolicyInputSchema = z
  .object({
    disposition: mailSecurityPolicyDispositionSchema,
    target: mailSecurityPolicyTargetSchema,
    value: z.string().trim().min(1).max(320),
    note: z.string().trim().max(500).nullable().optional(),
    enabled: z.boolean().default(true),
  })
  .strict();
export type CreateMailSecurityPolicyInput = z.infer<typeof createMailSecurityPolicyInputSchema>;

export const updateMailSecurityPolicyInputSchema = z
  .object({
    note: z.string().trim().max(500).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.note !== undefined || value.enabled !== undefined, "Change at least one field");
export type UpdateMailSecurityPolicyInput = z.infer<typeof updateMailSecurityPolicyInputSchema>;

export const mailProtectedIdentitySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  allowedDomains: z.array(z.string()),
  note: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MailProtectedIdentity = z.infer<typeof mailProtectedIdentitySchema>;

export const createMailProtectedIdentityInputSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    allowedDomains: z.array(z.string().trim().min(1).max(253)).min(1).max(20),
    note: z.string().trim().max(500).nullable().optional(),
    enabled: z.boolean().default(true),
  })
  .strict();
export type CreateMailProtectedIdentityInput = z.infer<typeof createMailProtectedIdentityInputSchema>;

export const mailSecuritySettingsSchema = z.object({
  trustedAuthservIds: z.array(z.string()),
  updatedAt: z.string().datetime(),
});
export type MailSecuritySettings = z.infer<typeof mailSecuritySettingsSchema>;

export const updateMailSecuritySettingsInputSchema = z
  .object({
    trustedAuthservIds: z.array(z.string().trim().min(1).max(253)).max(20),
  })
  .strict();

export const mailSecurityReportSchema = z.object({
  id: z.string().uuid(),
  mailboxId: z.string().uuid(),
  messageId: z.string().uuid(),
  senderAddress: z.string().nullable(),
  senderDomain: z.string().nullable(),
  status: mailSecurityReportStatusSchema,
  reportCount: z.number().int().positive(),
  assessment: mailSecurityAssessmentSchema,
  resolutionNote: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MailSecurityReport = z.infer<typeof mailSecurityReportSchema>;

export const resolveMailSecurityReportInputSchema = z
  .object({
    status: z.enum(["in_review", "confirmed", "dismissed"]),
    resolutionNote: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const mailSecurityListQuerySchema = z.object({
  status: mailSecurityReportStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
