import { topic } from "@k2b/sync";
import { logger } from "@valentinkolb/cloud/services";
import type { ContactLiveEvent, ContactServiceEvent, ContactServiceEventData } from "../live-events";
import { projectContactEventIds } from "./public-resources";

const log = logger("contacts:events");
const CONTACTS_EVENT_TENANT = "contacts";
const TOPIC_OPERATION_TIMEOUT_MS = 1_500;

export type ContactEventEnvelope = { internal: ContactServiceEvent; public: ContactLiveEvent };

const contactsTopic = topic<ContactEventEnvelope>({
  id: "changes",
  prefix: "cloud:contacts:events",
  retentionMs: 24 * 60 * 60 * 1_000,
  limits: { payloadBytes: 8_000 },
});

const eventResourceId = (event: ContactServiceEventData): string => {
  if (event.type === "contact.moved") return event.contactId;
  if ("contactId" in event) return event.contactId;
  return event.bookId;
};

const withTopicTimeout = async <T>(operation: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Contacts live topic timed out")), TOPIC_OPERATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const publishContactEvent = async (event: ContactServiceEventData, knownPublicEvent?: ContactLiveEvent): Promise<void> => {
  const payload: ContactServiceEvent = { ...event, at: new Date().toISOString() };
  const resourceId = eventResourceId(event);
  try {
    await withTopicTimeout(
      contactsTopic.pub({
        tenantId: CONTACTS_EVENT_TENANT,
        orderingKey: resourceId,
        data: {
          internal: payload,
          public: knownPublicEvent ? { ...knownPublicEvent, at: payload.at } : await projectContactEventIds(payload),
        },
      }),
    );
  } catch (error) {
    log.warn("Failed to publish Contacts event", {
      type: payload.type,
      resourceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const liveContactEvents = (config: { after?: string | null; signal?: AbortSignal }) =>
  contactsTopic.live({
    tenantId: CONTACTS_EVENT_TENANT,
    after: config.after ?? undefined,
    signal: config.signal,
  });

export const latestContactEventCursor = (): Promise<string | null> =>
  withTopicTimeout(contactsTopic.latestCursor({ tenantId: CONTACTS_EVENT_TENANT }));

/** SSR remains available when the best-effort live transport is unavailable. */
export const captureContactEventCursor = async (): Promise<string> => {
  try {
    return (await latestContactEventCursor()) ?? "0-0";
  } catch (error) {
    log.warn("Failed to capture Contacts event cursor", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "0-0";
  }
};
