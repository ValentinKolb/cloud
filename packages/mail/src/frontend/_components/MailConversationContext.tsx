import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { Placeholder } from "@valentinkolb/cloud/ui";
import {
  buildContactCreateHref,
  CONTACTS_LIVE_WS_TYPE,
  type ContactLiveClientMessage,
  type ContactLiveServerMessage,
  parseContactLiveServerMessage,
} from "@valentinkolb/cloud-app-contacts/integration";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { type MailConversationContext, mailConversationContextSchema, type RelatedMailPage, relatedMailPageSchema } from "../../contracts";
import { readApiError } from "./api-response";
import { buildMailContactParticipantRows } from "./mail-contact-context";

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

const conversationHref = (mailboxId: string, conversationId: string): string => {
  const url = new URL(window.location.href);
  url.pathname = `/app/mail/${mailboxId}`;
  url.searchParams.set("conversation", conversationId);
  url.searchParams.delete("message");
  return `${url.pathname}${url.search}`;
};

function RelatedMail(props: {
  mailboxId: string;
  conversationId: string;
  bookId: string;
  contactId: string;
  onOpenHref: (href: string) => void | Promise<void>;
}) {
  const [open, setOpen] = createSignal(false);
  const [page, setPage] = createSignal<RelatedMailPage>({ items: [], nextCursor: null });
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let controller: AbortController | null = null;

  const load = async (cursor?: string) => {
    controller?.abort();
    controller = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "10" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(
        `/api/mail/mailboxes/${props.mailboxId}/conversations/${props.conversationId}/contacts/${encodeURIComponent(props.bookId)}/${props.contactId}/history?${query}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load related Mail"));
      const next = relatedMailPageSchema.parse(await response.json());
      setPage((current) => ({ items: cursor ? [...current.items, ...next.items] : next.items, nextCursor: next.nextCursor }));
    } catch (cause) {
      if (!isAbortError(cause)) setError(cause instanceof Error ? cause.message : "Could not load related Mail");
    } finally {
      setLoading(false);
    }
  };

  onCleanup(() => controller?.abort());

  return (
    <div class="mt-2">
      <button
        type="button"
        class="btn-simple btn-xs"
        aria-expanded={open()}
        onClick={() => {
          const next = !open();
          setOpen(next);
          if (next && page().items.length === 0) void load();
        }}
      >
        <i class={`ti ${open() ? "ti-chevron-up" : "ti-history"}`} aria-hidden="true" /> Related Mail
      </button>
      <Show when={open()}>
        <Show when={!error()} fallback={<p class="mt-2 text-xs text-red-600 dark:text-red-300">{error()}</p>}>
          <Show
            when={page().items.length > 0}
            fallback={<p class="mt-2 text-xs text-dimmed">{loading() ? "Loading..." : "No related Mail"}</p>}
          >
            <div class="mt-2 flex flex-col gap-1">
              <For each={page().items}>
                {(item) => (
                  <button
                    type="button"
                    class="py-2 text-left text-xs hover:text-primary"
                    onClick={() => void props.onOpenHref(conversationHref(props.mailboxId, item.id))}
                  >
                    <span class="block truncate font-medium text-primary">{item.subject || "(no subject)"}</span>
                    <span class="block truncate text-dimmed">{item.participantSummary}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={page().nextCursor}>
            <button
              type="button"
              class="btn-simple btn-xs mt-2"
              disabled={loading()}
              onClick={() => void load(page().nextCursor ?? undefined)}
            >
              Load more
            </button>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

export default function MailConversationContext(props: {
  mailboxId: string;
  conversationId: string;
  active: boolean;
  onOpenHref: (href: string) => void | Promise<void>;
}) {
  const [context, setContext] = createSignal<MailConversationContext | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [liveEpoch, setLiveEpoch] = createSignal(0);
  let controller: AbortController | null = null;
  let loadedConversationId: string | null = null;
  let loadGeneration = 0;
  let refreshChain: Promise<boolean> = Promise.resolve(true);
  let pendingRefresh: Promise<boolean> | null = null;
  let requestedRefresh = 0;
  let appliedRefresh = 0;

  const loadContacts = async (contactsCursor?: string): Promise<boolean> => {
    const currentController = new AbortController();
    controller = currentController;
    const generation = loadGeneration;
    const conversationId = props.conversationId;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ contactsLimit: "50" });
      if (contactsCursor) query.set("contactsCursor", contactsCursor);
      const response = await fetch(`/api/mail/mailboxes/${props.mailboxId}/conversations/${conversationId}/context?${query}`, {
        signal: currentController.signal,
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not load Contacts"));
      const next = mailConversationContextSchema.parse(await response.json());
      if (generation !== loadGeneration || conversationId !== props.conversationId) return false;
      setContext((current) => ({
        ...next,
        contacts:
          contactsCursor && current?.contacts.status === "ready" && next.contacts.status === "ready"
            ? { ...next.contacts, items: [...current.contacts.items, ...next.contacts.items] }
            : next.contacts,
      }));
      return true;
    } catch (cause) {
      if (!isAbortError(cause)) setError(cause instanceof Error ? cause.message : "Could not load Contacts");
      return false;
    } finally {
      if (controller === currentController) {
        setLoaded(true);
        setLoading(false);
      }
    }
  };

  const queueContactsPage = (contactsCursor: string): Promise<boolean> => {
    const operation = refreshChain.then(() => loadContacts(contactsCursor));
    refreshChain = operation.catch(() => false);
    return operation;
  };

  const queueContactsRefresh = (): Promise<boolean> => {
    requestedRefresh += 1;
    if (pendingRefresh) return pendingRefresh;
    const operation = refreshChain.then(async () => {
      while (appliedRefresh < requestedRefresh) {
        const target = requestedRefresh;
        if (!(await loadContacts())) return false;
        appliedRefresh = target;
      }
      return true;
    });
    const tracked = operation.finally(() => {
      if (pendingRefresh === tracked) pendingRefresh = null;
    });
    pendingRefresh = tracked;
    refreshChain = tracked.catch(() => false);
    return tracked;
  };

  createEffect(() => {
    if (!props.active) {
      controller?.abort();
      return;
    }
    const conversationId = props.conversationId;
    if (loadedConversationId !== conversationId) {
      loadGeneration += 1;
      controller?.abort();
      loadedConversationId = conversationId;
      setContext(null);
      setLoaded(false);
      refreshChain = Promise.resolve(true);
      pendingRefresh = null;
      requestedRefresh = 0;
      appliedRefresh = 0;
    }
    void queueContactsRefresh();
    onCleanup(() => controller?.abort());
  });

  createEffect(() => {
    if (!props.active) return;
    props.conversationId;
    liveEpoch();
    const live = createLiveWebSocket<ContactLiveServerMessage>({
      url: "/api/contacts/ws",
      initialCursor: null,
      activity: "visible",
      subscribe: (cursor) =>
        ({
          type: CONTACTS_LIVE_WS_TYPE.subscribe,
          payload: { scope: { kind: "all" }, fromCursor: cursor },
        }) satisfies ContactLiveClientMessage,
      parse: parseContactLiveServerMessage,
      onMessage: (message, controls) => {
        if (message.type === CONTACTS_LIVE_WS_TYPE.ready) {
          void refreshChain.then((applied) => applied && controls.markApplied(message.payload.cursor));
        } else if (message.type === CONTACTS_LIVE_WS_TYPE.event) {
          void queueContactsRefresh().then((applied) => applied && controls.markApplied(message.payload.cursor));
        } else if (message.type === CONTACTS_LIVE_WS_TYPE.scopeChanged) {
          controls.terminate({ code: "contacts_changed", message: "Contacts access changed" });
          void queueContactsRefresh().finally(() => setLiveEpoch((epoch) => epoch + 1));
        } else if (message.type === CONTACTS_LIVE_WS_TYPE.revoked) {
          controls.terminate({ code: "contacts_revoked", message: "Contacts access was revoked" });
          void queueContactsRefresh();
        }
      },
    });
    live.connect();
    onCleanup(() => live.dispose());
  });

  onCleanup(() => controller?.abort());

  const participantRows = createMemo(() => {
    const current = context();
    if (!current || current.contacts.status !== "ready") return [];
    return buildMailContactParticipantRows({
      participants: current.participants,
      contacts: current.contacts.items,
      matchedEmails: current.contacts.matchedEmails,
    });
  });

  return (
    <section class="detail-section">
      <h3 class="detail-section-label">Contacts</h3>
      <Show when={loaded()} fallback={<p class="text-xs text-dimmed">Loading contacts...</p>}>
        <Show
          when={!error()}
          fallback={<Placeholder title="Contacts unavailable" description={error() ?? ""} icon="ti ti-address-book-off" />}
        >
          <Show
            when={context()?.contacts.status === "ready"}
            fallback={
              <Placeholder
                title="Contacts unavailable"
                description="Contact context could not be refreshed."
                icon="ti ti-address-book-off"
              />
            }
          >
            <Show when={participantRows().length > 0} fallback={<Placeholder title="No external participants" icon="ti ti-user-off" />}>
              <div class="flex flex-col gap-4">
                <For each={participantRows()}>
                  {(participant) => (
                    <article class="min-w-0">
                      <div class="flex min-w-0 items-start gap-2">
                        <i class="ti ti-user mt-0.5 text-dimmed" aria-hidden="true" />
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-sm font-medium text-primary">{participant.displayName || participant.email}</p>
                          <Show when={participant.displayName}>
                            <p class="truncate text-xs text-secondary" title={participant.email}>
                              {participant.email}
                            </p>
                          </Show>

                          <Show
                            when={participant.contacts.length > 0}
                            fallback={
                              <Show
                                when={!participant.hasMatch}
                                fallback={<p class="mt-2 text-xs text-dimmed">Matching contact available. Load more to view it.</p>}
                              >
                                <a
                                  class="btn-secondary btn-sm mt-2 w-full justify-center"
                                  href={buildContactCreateHref({ email: participant.email, name: participant.displayName ?? undefined })}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <i class="ti ti-user-plus" aria-hidden="true" /> Create contact
                                </a>
                              </Show>
                            }
                          >
                            <div class="mt-2 flex flex-col gap-3">
                              <For each={participant.contacts}>
                                {(contact) => (
                                  <div class="min-w-0">
                                    <a class="block truncate text-sm font-medium text-primary hover:underline" href={contact.href}>
                                      {contact.displayName}
                                    </a>
                                    <p class="truncate text-xs text-dimmed">
                                      {[contact.jobTitle, contact.companyName, contact.bookName].filter(Boolean).join(" · ")}
                                    </p>
                                    <Show when={contact.phones[0]}>
                                      {(phone) => (
                                        <a class="text-xs text-secondary hover:text-primary" href={`tel:${phone().value}`}>
                                          {phone().value}
                                        </a>
                                      )}
                                    </Show>
                                    <RelatedMail
                                      mailboxId={props.mailboxId}
                                      conversationId={props.conversationId}
                                      bookId={contact.bookId}
                                      contactId={contact.contactId}
                                      onOpenHref={props.onOpenHref}
                                    />
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      </div>
                    </article>
                  )}
                </For>
              </div>
              <Show when={context()?.contacts.status === "ready" ? context()!.contacts.nextCursor : null}>
                {(cursor) => (
                  <button
                    type="button"
                    class="btn-simple btn-xs mt-3"
                    disabled={loading()}
                    onClick={() => void queueContactsPage(cursor())}
                  >
                    Load more
                  </button>
                )}
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
