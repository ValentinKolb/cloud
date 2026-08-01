import type { z } from "zod";
import { ContactResolveMatchDataSchema } from "@valentinkolb/cloud-app-contacts/capability-contracts";
import type { mailConversationParticipantSchema } from "../../contracts";

type MailConversationParticipant = z.infer<typeof mailConversationParticipantSchema>;
type ContactMatch = z.infer<typeof ContactResolveMatchDataSchema>;

type MailContactParticipantRow = MailConversationParticipant & {
  contacts: ContactMatch[];
  hasMatch: boolean;
};

export const buildMailContactParticipantRows = (params: {
  participants: MailConversationParticipant[];
  contacts: ContactMatch[];
  matchedEmails: string[];
}): MailContactParticipantRow[] => {
  const matchesByEmail = new Map<string, ContactMatch[]>();
  for (const contact of params.contacts) {
    for (const email of contact.matchedEmails) {
      const matches = matchesByEmail.get(email);
      if (matches) matches.push(contact);
      else matchesByEmail.set(email, [contact]);
    }
  }
  const matchedEmails = new Set(params.matchedEmails);
  return params.participants.map((participant) => ({
    ...participant,
    contacts: matchesByEmail.get(participant.email) ?? [],
    hasMatch: matchedEmails.has(participant.email),
  }));
};
