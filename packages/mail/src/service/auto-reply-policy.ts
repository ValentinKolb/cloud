const autoReplySuppressionReasons = [
  "missing_sender",
  "null_return_path",
  "mailbox_sender",
  "automated_message",
  "bulk_message",
  "mailing_list",
  "sender_suppressed",
  "delivery_status",
  "already_replied",
] as const;

export type AutoReplySuppressionReason = (typeof autoReplySuppressionReasons)[number];

export type AutoReplyFacts = {
  senderAddresses: readonly string[];
  mailboxAddresses: readonly string[];
  returnPath?: string | null;
  autoSubmitted?: string | null;
  precedence?: string | null;
  listId?: string | null;
  autoResponseSuppress?: string | null;
  deliveryStatus?: boolean;
  alreadyReplied?: boolean;
};

type AutoReplyPolicyDecision =
  | { allowed: true; reasons: readonly [] }
  | { allowed: false; reasons: readonly AutoReplySuppressionReason[] };

const connectorProtocolFactsSchema = z.object({
  returnPath: z.string().nullable(),
  autoSubmitted: z.string().nullable(),
  precedence: z.string().nullable(),
  listId: z.string().nullable(),
  autoResponseSuppress: z.string().nullable(),
  contentType: z.string().nullable(),
  deliveryStatus: z.boolean(),
});

const UNKNOWN_PROTOCOL_FACTS: ConnectorProtocolFacts = {
  returnPath: null,
  autoSubmitted: null,
  precedence: null,
  listId: null,
  autoResponseSuppress: null,
  contentType: null,
  deliveryStatus: false,
};

export const parseConnectorProtocolFacts = (value: unknown): ConnectorProtocolFacts => {
  const parsed = connectorProtocolFactsSchema.safeParse(value);
  return parsed.success ? parsed.data : UNKNOWN_PROTOCOL_FACTS;
};

const normalizeAddress = (value: string): string => value.trim().replace(/^<|>$/g, "").toLowerCase();
const normalizeHeader = (value: string | null | undefined): string => value?.trim().toLowerCase() ?? "";

export const parseReturnPathAddress = (value: string | null | undefined): string | null => {
  const source = value?.trim() ?? "";
  if (source === "" || source === "<>") return null;
  const candidate = source.startsWith("<") && source.endsWith(">") ? source.slice(1, -1).trim() : source;
  return /^[^<>\s,]+@[^<>\s,]+$/u.test(candidate) ? candidate.toLowerCase() : null;
};

/**
 * Evaluates protocol-level loop guards only. Business rules and rate limits are
 * applied separately so this decision remains deterministic and auditable.
 */
export const evaluateAutoReplyPolicy = (facts: AutoReplyFacts): AutoReplyPolicyDecision => {
  const reasons: AutoReplySuppressionReason[] = [];
  const senders = new Set(facts.senderAddresses.map(normalizeAddress).filter(Boolean));
  const mailboxAddresses = new Set(facts.mailboxAddresses.map(normalizeAddress).filter(Boolean));
  const returnPath = normalizeHeader(facts.returnPath);
  const autoSubmitted = normalizeHeader(facts.autoSubmitted);
  const precedence = normalizeHeader(facts.precedence);
  const suppressTokens = new Set(
    normalizeHeader(facts.autoResponseSuppress)
      .split(/[\s,]+/)
      .filter(Boolean),
  );

  if (senders.size === 0) reasons.push("missing_sender");
  if (returnPath === "<>" || returnPath === "") reasons.push("null_return_path");
  if ([...senders].some((address) => mailboxAddresses.has(address))) reasons.push("mailbox_sender");
  if (autoSubmitted !== "" && autoSubmitted !== "no") reasons.push("automated_message");
  if (["bulk", "list", "junk"].includes(precedence)) reasons.push("bulk_message");
  if (normalizeHeader(facts.listId) !== "") reasons.push("mailing_list");
  if (["all", "autoreply", "oof"].some((token) => suppressTokens.has(token))) reasons.push("sender_suppressed");
  if (facts.deliveryStatus === true) reasons.push("delivery_status");
  if (facts.alreadyReplied === true) reasons.push("already_replied");

  return reasons.length === 0 ? { allowed: true, reasons: [] } : { allowed: false, reasons };
};
import { z } from "zod";
import type { ConnectorProtocolFacts } from "./connectors";
