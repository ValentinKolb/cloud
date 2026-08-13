import type { z } from "zod";
import type { contactResolveMatchSchema } from "../../app-integration-contracts";
import type { mailConversationParticipantSchema } from "../../contracts";

type MailConversationParticipant = z.infer<typeof mailConversationParticipantSchema>;
type ContactMatch = z.infer<typeof contactResolveMatchSchema>;

type MailContactParticipantRow = MailConversationParticipant & {
  contacts: ContactMatch[];
  hasMatch: boolean;
  showParticipantHeading: boolean;
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
  return params.participants.map((participant) => {
    const contacts = matchesByEmail.get(participant.email) ?? [];
    return {
      ...participant,
      contacts,
      hasMatch: matchedEmails.has(participant.email),
      showParticipantHeading: contacts.length > 1,
    };
  });
};
