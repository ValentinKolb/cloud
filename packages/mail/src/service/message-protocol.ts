import type { Readable } from "node:stream";
import { type Headers, Splitter } from "@zone-eu/mailsplit";
import { z } from "zod";

const MAX_HEADER_LENGTH = 4_096;
const MAX_LIST_LINKS = 20;
const MAX_MESSAGE_HEADER_BYTES = 2 * 1024 * 1024;

const nullableHeaderSchema = z.string().trim().max(MAX_HEADER_LENGTH).nullable();
const listLinksSchema = z.array(z.string().trim().min(1).max(2_048)).max(MAX_LIST_LINKS);

const messageProtocolFactsV1Schema = z
  .object({
    version: z.literal(1),
    returnPath: nullableHeaderSchema,
    autoSubmitted: nullableHeaderSchema,
    precedence: nullableHeaderSchema,
    autoResponseSuppress: nullableHeaderSchema,
    contentType: nullableHeaderSchema,
    deliveryStatus: z.boolean(),
    list: z
      .object({
        id: nullableHeaderSchema,
        unsubscribe: listLinksSchema,
        unsubscribePost: nullableHeaderSchema,
        post: listLinksSchema,
        help: listLinksSchema,
        archive: listLinksSchema,
      })
      .strict(),
    priority: z
      .object({
        importance: nullableHeaderSchema,
        priority: nullableHeaderSchema,
        xPriority: nullableHeaderSchema,
      })
      .strict(),
    receipts: z
      .object({
        dispositionNotificationTo: nullableHeaderSchema,
      })
      .strict(),
    spam: z
      .object({
        flag: nullableHeaderSchema,
        status: nullableHeaderSchema,
        score: nullableHeaderSchema,
      })
      .strict(),
  })
  .strict();

const messageProtocolFactsSchema = z.discriminatedUnion("version", [messageProtocolFactsV1Schema]);
export type MessageProtocolFacts = z.infer<typeof messageProtocolFactsSchema>;

export const EMPTY_MESSAGE_PROTOCOL_FACTS: MessageProtocolFacts = {
  version: 1,
  returnPath: null,
  autoSubmitted: null,
  precedence: null,
  autoResponseSuppress: null,
  contentType: null,
  deliveryStatus: false,
  list: {
    id: null,
    unsubscribe: [],
    unsubscribePost: null,
    post: [],
    help: [],
    archive: [],
  },
  priority: {
    importance: null,
    priority: null,
    xPriority: null,
  },
  receipts: {
    dispositionNotificationTo: null,
  },
  spam: {
    flag: null,
    status: null,
    score: null,
  },
};

export const parseMessageProtocolFacts = (value: unknown): MessageProtocolFacts => {
  const parsed = messageProtocolFactsSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_MESSAGE_PROTOCOL_FACTS;
};

export const readMessageRootHeaders = async (source: Readable): Promise<Headers> => {
  const splitter = new Splitter({
    maxHeadSize: MAX_MESSAGE_HEADER_BYTES,
  });
  source.pipe(splitter);
  try {
    for await (const chunk of splitter) {
      if (chunk.type === "node" && chunk.root && chunk.headers) return chunk.headers;
    }
    throw Object.assign(new Error("Message source does not contain a complete header block"), {
      code: "MESSAGE_HEADERS_MISSING",
    });
  } finally {
    source.unpipe(splitter);
    source.destroy();
    splitter.destroy();
  }
};

const headerText = (value: unknown): string | null => {
  let text: string | null = null;
  if (typeof value === "string") text = value;
  else if (Array.isArray(value)) text = value.map(String).join(", ");
  else if (value && typeof value === "object") {
    if ("text" in value && typeof value.text === "string") text = value.text;
    else if ("value" in value && typeof value.value === "string") text = value.value;
  } else if (value != null) text = String(value);
  const normalized = text?.trim() ?? "";
  return normalized === "" ? null : normalized.slice(0, MAX_HEADER_LENGTH);
};

const listLinks = (value: unknown): string[] => {
  const text = headerText(value);
  if (!text) return [];
  const bracketed = [...text.matchAll(/<([^<>]+)>/gu)].map((match) => match[1]?.trim()).filter((entry): entry is string => Boolean(entry));
  const candidates = bracketed.length > 0 ? bracketed : text.split(",").map((entry) => entry.trim());
  return [...new Set(candidates.filter(Boolean).map((entry) => entry.slice(0, 2_048)))].slice(0, MAX_LIST_LINKS);
};

export const extractMessageProtocolFacts = (getHeader: (name: string) => unknown): MessageProtocolFacts => {
  const contentType = headerText(getHeader("content-type"));
  return {
    version: 1,
    returnPath: headerText(getHeader("return-path")),
    autoSubmitted: headerText(getHeader("auto-submitted")),
    precedence: headerText(getHeader("precedence")),
    autoResponseSuppress: headerText(getHeader("x-auto-response-suppress")),
    contentType,
    deliveryStatus: /(?:^|;)\s*report-type\s*=\s*["']?delivery-status\b/iu.test(contentType ?? ""),
    list: {
      id: headerText(getHeader("list-id")),
      unsubscribe: listLinks(getHeader("list-unsubscribe")),
      unsubscribePost: headerText(getHeader("list-unsubscribe-post")),
      post: listLinks(getHeader("list-post")),
      help: listLinks(getHeader("list-help")),
      archive: listLinks(getHeader("list-archive")),
    },
    priority: {
      importance: headerText(getHeader("importance")),
      priority: headerText(getHeader("priority")),
      xPriority: headerText(getHeader("x-priority")),
    },
    receipts: {
      dispositionNotificationTo: headerText(getHeader("disposition-notification-to")),
    },
    spam: {
      flag: headerText(getHeader("x-spam-flag")),
      status: headerText(getHeader("x-spam-status")),
      score: headerText(getHeader("x-spam-score")),
    },
  };
};
