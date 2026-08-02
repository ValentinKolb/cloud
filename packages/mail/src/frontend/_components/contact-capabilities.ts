import { invokeCapability } from "@valentinkolb/cloud/capabilities";
import { contactBooksSchema, contactMutationDataSchema, contactSuggestionsSchema } from "../../app-integration-contracts";

const invokeContactsCapability = async <T>(params: {
  kind: "query" | "action";
  id: string;
  input: unknown;
  parseData: (value: unknown) => T;
  signal?: AbortSignal;
  idempotencyKey?: string;
}) => {
  const result = await invokeCapability<unknown>({
    appId: "contacts",
    capabilityId: params.id,
    kind: params.kind,
    input: params.input,
    signal: params.signal,
    idempotencyKey: params.idempotencyKey,
  });
  if (!result.ok) throw new Error(result.error.message);
  return { ...result.data, data: params.parseData(result.data.data) };
};

export const suggestContacts = (input: { query: string; cursor?: string; limit?: number }, signal?: AbortSignal) =>
  invokeContactsCapability({
    kind: "query",
    id: "contact.suggest",
    input,
    parseData: (value) => contactSuggestionsSchema.parse(value),
    signal,
  });

export const listWritableContactBooks = (input: { cursor?: string; query?: string; limit?: number } = {}, signal?: AbortSignal) =>
  invokeContactsCapability({
    kind: "query",
    id: "book.list",
    input: { ...input, minimumPermission: "write" },
    parseData: (value) => contactBooksSchema.parse(value),
    signal,
  });

export const createContact = (
  input: {
    bookId: string;
    label?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    emails?: { label?: string | null; email: string }[];
    phones?: { label?: string | null; phone: string }[];
  },
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  invokeContactsCapability({
    kind: "action",
    id: "contact.create",
    input,
    parseData: (value) => contactMutationDataSchema.parse(value),
    idempotencyKey,
    signal,
  });
