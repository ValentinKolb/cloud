import type { MailAddress } from "../../contracts";
import { parseMailRecipient } from "./mail-recipient";

const MAX_MAILTO_LENGTH = 32 * 1024;
const MAX_BODY_LENGTH = 24 * 1024;
const MAX_RECIPIENTS = 200;

type MailComposeIntent = {
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  body: string;
};

type MailComposeIntentResult = { ok: true; intent: MailComposeIntent } | { ok: false; message: string };

const decode = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const splitRecipients = (values: string[]): string[] =>
  values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

const parseRecipients = (values: string[], label: string): MailAddress[] | string => {
  const recipients = splitRecipients(values);
  if (recipients.length > MAX_RECIPIENTS) return `${label} contains too many recipients.`;
  const parsed = recipients.map(parseMailRecipient);
  if (parsed.some((recipient) => recipient === null)) return `${label} contains an invalid email address.`;
  const unique = new Map<string, MailAddress>();
  for (const recipient of parsed as MailAddress[]) unique.set(recipient.address.toLowerCase(), recipient);
  return [...unique.values()];
};

const singleHeader = (headers: Map<string, string[]>, name: string): string | null | undefined => {
  const values = headers.get(name) ?? [];
  if (values.length > 1) return undefined;
  return values[0] ?? null;
};

const parseHeaders = (rawQuery: string): { ok: true; headers: Map<string, string[]> } | { ok: false } => {
  const headers = new Map<string, string[]>();
  for (const pair of rawQuery.split("&")) {
    if (!pair) continue;
    const equals = pair.indexOf("=");
    const rawName = equals === -1 ? pair : pair.slice(0, equals);
    const rawValue = equals === -1 ? "" : pair.slice(equals + 1);
    const name = decode(rawName)?.trim().toLowerCase();
    const value = decode(rawValue);
    if (!name || value === null) return { ok: false };
    headers.set(name, [...(headers.get(name) ?? []), value]);
  }
  return { ok: true, headers };
};

const parseContent = (headers: Map<string, string[]>): { ok: true; subject: string; body: string } | { ok: false; message: string } => {
  const subject = singleHeader(headers, "subject");
  const body = singleHeader(headers, "body");
  if (subject === undefined || body === undefined) {
    return { ok: false, message: "This email link repeats a field that may only appear once." };
  }
  const normalizedSubject = (subject ?? "").replaceAll(/[\r\n]+/g, " ").trim();
  const normalizedBody = (body ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (normalizedSubject.length > 998) return { ok: false, message: "The subject in this email link is too long." };
  if (normalizedBody.length > MAX_BODY_LENGTH) return { ok: false, message: "The message in this email link is too long." };
  return { ok: true, subject: normalizedSubject, body: normalizedBody };
};

const parseRecipientFields = (
  path: string,
  headers: Map<string, string[]>,
): { ok: true; to: MailAddress[]; cc: MailAddress[]; bcc: MailAddress[] } | { ok: false; message: string } => {
  const to = parseRecipients([path, ...(headers.get("to") ?? [])], "To");
  const cc = parseRecipients(headers.get("cc") ?? [], "Cc");
  const bcc = parseRecipients(headers.get("bcc") ?? [], "Bcc");
  if (typeof to === "string") return { ok: false, message: to };
  if (typeof cc === "string") return { ok: false, message: cc };
  if (typeof bcc === "string") return { ok: false, message: bcc };
  return { ok: true, to, cc, bcc };
};

const emptyMailComposeIntent = (): MailComposeIntent => ({
  to: [],
  cc: [],
  bcc: [],
  subject: "",
  body: "",
});

export const parseMailtoIntent = (value: string | null | undefined): MailComposeIntentResult => {
  if (!value) return { ok: true, intent: emptyMailComposeIntent() };
  if (value.length > MAX_MAILTO_LENGTH) return { ok: false, message: "This email link is too large to open safely." };
  if (!value.toLowerCase().startsWith("mailto:")) return { ok: false, message: "This is not a valid email link." };

  const source = value.slice("mailto:".length);
  const separator = source.indexOf("?");
  const rawPath = separator === -1 ? source : source.slice(0, separator);
  const rawQuery = separator === -1 ? "" : source.slice(separator + 1);
  const path = decode(rawPath);
  if (path === null) return { ok: false, message: "This email link contains invalid encoding." };

  const parsedHeaders = parseHeaders(rawQuery);
  if (!parsedHeaders.ok) return { ok: false, message: "This email link contains invalid encoding." };
  const content = parseContent(parsedHeaders.headers);
  if (!content.ok) return content;
  const recipients = parseRecipientFields(path, parsedHeaders.headers);
  if (!recipients.ok) return recipients;

  return {
    ok: true,
    intent: {
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      subject: content.subject,
      body: content.body,
    },
  };
};
