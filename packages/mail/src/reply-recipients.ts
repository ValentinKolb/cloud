import type { MailAddress } from "./contracts";

type ReplySource = {
  from: MailAddress[];
  replyTo: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
};

type MailboxIdentityAddress = {
  fromAddress: string;
  replyTo: string | null;
};

const uniqueExternalAddresses = (addresses: MailAddress[], excluded: ReadonlySet<string>): MailAddress[] => {
  const seen = new Set(excluded);
  const result: MailAddress[] = [];
  for (const item of addresses) {
    const address = item.address.trim();
    const key = address.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ name: item.name?.trim() || null, address });
  }
  return result;
};

export const deriveReplyAddressObjects = (
  source: ReplySource,
  intent: "reply" | "reply_all",
  identities: MailboxIdentityAddress[],
): { to: MailAddress[]; cc: MailAddress[] } => {
  const ownAddresses = new Set(
    identities
      .flatMap((identity) => [identity.fromAddress, identity.replyTo])
      .flatMap((address) => {
        const normalized = address?.trim().toLowerCase();
        return normalized ? [normalized] : [];
      }),
  );
  let to = uniqueExternalAddresses(source.replyTo.length > 0 ? source.replyTo : source.from, ownAddresses);
  if (to.length === 0 && source.replyTo.length > 0) to = uniqueExternalAddresses(source.from, ownAddresses);

  // Messages sent by this mailbox reply to their original external recipients.
  if (to.length === 0) {
    to = uniqueExternalAddresses(source.to, ownAddresses);
    if (to.length === 0) to = uniqueExternalAddresses(source.cc, ownAddresses);
  }
  if (intent === "reply") return { to, cc: [] };

  const toAddresses = new Set([...ownAddresses, ...to.map((address) => address.address.toLowerCase())]);
  return { to, cc: uniqueExternalAddresses([...source.to, ...source.cc], toAddresses) };
};
