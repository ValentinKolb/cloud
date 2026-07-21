import type { ContactMailMatch } from "@valentinkolb/cloud-app-contacts/integration";
import type { z } from "zod";
import type { mailConversationParticipantSchema } from "../../contracts";

type MailConversationParticipant = z.infer<typeof mailConversationParticipantSchema>;

type MailContactParticipantRow = MailConversationParticipant & {
  contacts: ContactMailMatch[];
  hasMatch: boolean;
};

export const buildMailContactParticipantRows = (params: {
  participants: MailConversationParticipant[];
  contacts: ContactMailMatch[];
  matchedEmails: string[];
}): MailContactParticipantRow[] => {
  const matchesByEmail = new Map<string, ContactMailMatch[]>();
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
