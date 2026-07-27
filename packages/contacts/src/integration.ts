import { z } from "zod";

export const CONTACTS_MAIL_RESOLVE_PATH = "/api/contacts/integrations/mail/resolve-participants";
export const CONTACTS_MAIL_SUGGESTIONS_PATH = "/api/contacts/search";
export const CONTACTS_CREATE_PATH = "/app/contacts";
export const CONTACTS_CREATE_QUERY_KEYS = ["createContact", "email", "name"] as const;

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
    bookName: z.string().min(1),
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
    matchedEmails: z.array(NormalizedParticipantEmailSchema).max(100),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const ContactMailSuggestionSchema = z.object({
  label: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  companyName: z.string().nullable(),
  emails: z.array(z.object({ email: z.email() })),
});

export const ContactMailSuggestionsResponseSchema = z.object({
  data: z.array(ContactMailSuggestionSchema),
});

export const ContactCreateSeedSchema = z
  .object({
    email: NormalizedParticipantEmailSchema,
    name: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const buildContactCreateHref = (seed: ContactCreateSeed): string => {
  const parsed = ContactCreateSeedSchema.parse(seed);
  const query = new URLSearchParams({ createContact: "1", email: parsed.email });
  if (parsed.name) query.set("name", parsed.name);
  return `${CONTACTS_CREATE_PATH}?${query}`;
};

export const parseContactCreateSeed = (query: URLSearchParams): ContactCreateSeed | null => {
  if (query.get("createContact") !== "1") return null;
  const parsed = ContactCreateSeedSchema.safeParse({
    email: query.get("email"),
    name: query.get("name") || undefined,
  });
  return parsed.success ? parsed.data : null;
};

export type ResolveMailParticipantsInput = z.infer<typeof ResolveMailParticipantsInputSchema>;
export type ContactMailMatch = z.infer<typeof ContactMailMatchSchema>;
export type ResolveMailParticipantsResponse = z.infer<typeof ResolveMailParticipantsResponseSchema>;
export type ContactMailSuggestion = z.infer<typeof ContactMailSuggestionSchema>;
export type ContactCreateSeed = z.infer<typeof ContactCreateSeedSchema>;

export {
  CONTACTS_LIVE_WS_TYPE,
  type ContactLiveClientMessage,
  type ContactLiveServerMessage,
  parseContactLiveServerMessage,
} from "./live-events";
