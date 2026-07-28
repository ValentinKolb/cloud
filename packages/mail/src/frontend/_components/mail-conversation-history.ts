type HistoryMessage = {
  id: string;
  from: Array<{ address: string }>;
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

export const newestFirstMessages = <T>(messages: readonly T[]): T[] => [...messages].reverse();

export const initialConversationMessageId = (messages: readonly HistoryMessage[]): string | null => messages.at(-1)?.id ?? null;

export const isNearConversationStart = (metrics: { scrollTop: number }, threshold = 96): boolean => metrics.scrollTop <= threshold;
