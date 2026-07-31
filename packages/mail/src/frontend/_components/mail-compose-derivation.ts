import { type DateContext, dates } from "@k2b/stdlib";
import type { DraftIntent, SenderIdentity } from "../../contracts";
import { deriveReplyAddressObjects } from "../../reply-recipients";
import type { MessageDetail } from "../../service/messages";

type RecipientSeed = { to: string[]; cc: string[] };

export const formatMailAddress = (address: { name: string | null; address: string }): string =>
  address.name ? `${address.name} <${address.address}>` : address.address;

export const replySubject = (subject: string): string => (/^re:/i.test(subject) ? subject : `Re: ${subject}`);
export const forwardSubject = (subject: string): string => (/^fwd:/i.test(subject) ? subject : `Fwd: ${subject}`);

export const forwardMessageBody = (message: MessageDetail, dateConfig: DateContext): string => `

---------- Forwarded message ----------
From: ${message.from.map(formatMailAddress).join(", ") || "Unknown sender"}
Date: ${dates.formatDateTime(message.internalDate, dateConfig)}
Subject: ${message.subject || "(no subject)"}
To: ${message.to.map(formatMailAddress).join(", ") || "Undisclosed recipients"}

${message.forwardText}`;

export const deriveReplyIdentityId = (message: MessageDetail, identities: SenderIdentity[]): string | null => {
  const verified = identities.filter((identity) => identity.status === "verified");
  const match = (addresses: Array<{ address: string }>): SenderIdentity[] => {
    const normalized = new Set(addresses.map((item) => item.address.trim().toLowerCase()));
    return verified.filter(
      (identity) =>
        normalized.has(identity.fromAddress.toLowerCase()) || (identity.replyTo ? normalized.has(identity.replyTo.toLowerCase()) : false),
    );
  };
  const recipientMatches = match([...message.to, ...message.cc]);
  const matches = recipientMatches.length > 0 ? recipientMatches : match(message.from);
  if (matches.length === 1) return matches[0]!.id;
  const defaultMatch = matches.find((identity) => identity.isDefault);
  if (defaultMatch) return defaultMatch.id;
  if (matches.length > 1) return null;
  return verified.find((identity) => identity.isDefault)?.id ?? verified[0]?.id ?? null;
};

export const deriveReplyRecipients = (
  message: MessageDetail,
  intent: Extract<DraftIntent, "reply" | "reply_all">,
  identities: SenderIdentity[],
): RecipientSeed => {
  const recipients = deriveReplyAddressObjects(message, intent, identities);
  return {
    to: recipients.to.map((item) => item.address),
    cc: recipients.cc.map((item) => item.address),
  };
};
