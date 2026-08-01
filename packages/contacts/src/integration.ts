import { z } from "zod";

const CONTACTS_CREATE_PATH = "/app/contacts";
export const CONTACTS_CREATE_QUERY_KEYS = ["createContact", "email", "name"] as const;

const NormalizedParticipantEmailSchema = z.string().trim().toLowerCase().max(320).pipe(z.email());

const ContactCreateSeedSchema = z
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

type ContactCreateSeed = z.infer<typeof ContactCreateSeedSchema>;
