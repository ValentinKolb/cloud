type HistoryMessage = {
  id: string;
  from: Array<{ address: string }>;
  flags: string[];
};

type HistoryIdentity = {
  fromAddress: string;
  status: string;
};

const normalizedAddress = (value: string): string => value.trim().toLowerCase();

export const isOutgoingMessage = (message: Pick<HistoryMessage, "from">, identities: HistoryIdentity[]): boolean => {
  const ownAddresses = new Set(
    identities.filter((identity) => identity.status === "verified").map((identity) => normalizedAddress(identity.fromAddress)),
  );
  return message.from.some((sender) => ownAddresses.has(normalizedAddress(sender.address)));
};

export const initialConversationMessageId = (messages: HistoryMessage[], identities: HistoryIdentity[]): string | null => {
  const firstUnread = messages.find(
    (message) => !isOutgoingMessage(message, identities) && !message.flags.some((flag) => flag.toLowerCase() === "\\seen"),
  );
  return firstUnread?.id ?? messages.at(-1)?.id ?? null;
};

export const isNearConversationEnd = (
  metrics: { scrollTop: number; clientHeight: number; scrollHeight: number },
  threshold = 96,
): boolean => metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
