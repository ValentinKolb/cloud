import { type MailAddress, type MailDraft, mailAddressSchema } from "../../contracts";

const angleAddressPattern = /^(.*?)\s*<([^<>]+)>$/;

export const formatMailRecipient = (recipient: MailAddress): string =>
  recipient.name ? `${recipient.name} <${recipient.address}>` : recipient.address;

export const formatMailRecipients = (recipients: MailDraft["to"]): string[] => recipients.map(formatMailRecipient);

export const parseMailRecipient = (value: string): MailAddress | null => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const match = normalized.match(angleAddressPattern);
  const address = (match?.[2] ?? normalized).trim().toLowerCase();
  const name = match?.[1]?.trim().replace(/^"|"$/g, "") || null;
  const parsed = mailAddressSchema.safeParse({ name, address });
  return parsed.success ? parsed.data : null;
};

export const parseMailRecipients = (values: string[]): MailAddress[] => {
  const recipients = new Map<string, MailAddress>();
  for (const value of values) {
    const recipient = parseMailRecipient(value);
    if (!recipient) continue;
    const existing = recipients.get(recipient.address);
    recipients.set(recipient.address, existing?.name && !recipient.name ? existing : recipient);
  }
  return [...recipients.values()];
};
