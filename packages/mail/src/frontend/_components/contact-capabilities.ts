import {
  ContactBookListDataSchema,
  ContactBookListInputSchema,
  ContactCreateInputSchema,
  ContactMutationDataSchema,
  ContactSuggestDataSchema,
  ContactSuggestInputSchema,
} from "@valentinkolb/cloud-app-contacts/capability-contracts";
import { CapabilityErrorSchema, capabilityResultSchema, type CapabilityResult } from "@valentinkolb/cloud/contracts";
import { z } from "zod";

const invokeContactsCapability = async <T>(params: {
  kind: "queries" | "actions";
  id: string;
  input: unknown;
  dataSchema: z.ZodType<T>;
  signal?: AbortSignal;
  idempotencyKey?: string;
}): Promise<CapabilityResult<T>> => {
  const response = await fetch(`/api/capabilities/v1/${params.kind}/contacts/${encodeURIComponent(params.id)}`, {
    method: "POST",
    signal: params.signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {}),
    },
    body: JSON.stringify({ input: params.input }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = CapabilityErrorSchema.safeParse(body);
    throw new Error(error.success ? error.data.message : "Contacts are temporarily unavailable");
  }
  return capabilityResultSchema(params.dataSchema).parse(body);
};

export const suggestContacts = (input: z.input<typeof ContactSuggestInputSchema>, signal?: AbortSignal) =>
  invokeContactsCapability({
    kind: "queries",
    id: "contact.suggest",
    input: ContactSuggestInputSchema.parse(input),
    dataSchema: ContactSuggestDataSchema,
    signal,
  });

export const listWritableContactBooks = (input: { cursor?: string; query?: string; limit?: number } = {}, signal?: AbortSignal) =>
  invokeContactsCapability({
    kind: "queries",
    id: "book.list",
    input: ContactBookListInputSchema.parse({ ...input, minimumPermission: "write" }),
    dataSchema: ContactBookListDataSchema,
    signal,
  });

export const createContact = (
  input: z.input<typeof ContactCreateInputSchema>,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  invokeContactsCapability({
    kind: "actions",
    id: "contact.create",
    input: ContactCreateInputSchema.parse(input),
    dataSchema: ContactMutationDataSchema,
    idempotencyKey,
    signal,
  });
