import { z } from "zod";

export const CONTACTS_MAIL_RESOLVE_PATH = "/api/contacts/integrations/mail/resolve-participants";

export const NormalizedParticipantEmailSchema = z.string().trim().toLowerCase().max(320).pipe(z.email());

export const ResolveMailParticipantsInputSchema = z
  .object({
    emails: z.array(NormalizedParticipantEmailSchema).min(1).max(100),
    contactIds: z.array(z.uuid()).max(20).optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.number().int().min(1).max(50).default(25),
  })
  .strict()
  .transform((value) => ({
    ...value,
    emails: [...new Set(value.emails)],
    ...(value.contactIds ? { contactIds: [...new Set(value.contactIds)] } : {}),
  }));

export const ContactMailPointSchema = z
  .object({
    label: z.string().nullable(),
    value: z.string().min(1),
  })
  .strict();

export const ContactMailMatchSchema = z
  .object({
    contactId: z.uuid(),
    bookId: z.string().min(1),
    displayName: z.string().min(1),
    companyName: z.string().nullable(),
    jobTitle: z.string().nullable(),
    matchedEmails: z.array(NormalizedParticipantEmailSchema).min(1).max(100),
    emails: z.array(ContactMailPointSchema).max(20),
    phones: z.array(ContactMailPointSchema).max(20),
    contactPointsTruncated: z.boolean(),
    href: z.string().startsWith("/app/contacts/"),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const ResolveMailParticipantsResponseSchema = z
  .object({
    items: z.array(ContactMailMatchSchema).max(50),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type ResolveMailParticipantsInput = z.infer<typeof ResolveMailParticipantsInputSchema>;
export type ContactMailMatch = z.infer<typeof ContactMailMatchSchema>;
export type ResolveMailParticipantsResponse = z.infer<typeof ResolveMailParticipantsResponseSchema>;

export {
  CONTACTS_LIVE_WS_TYPE,
  type ContactLiveClientMessage,
  type ContactLiveServerMessage,
  parseContactLiveServerMessage,
} from "./live-events";
