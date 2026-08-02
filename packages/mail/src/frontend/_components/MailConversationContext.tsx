import { mutation } from "@k2b/stdlib/solid";
import { Placeholder, prompts, Button } from "@k2b/ui";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { MailConversationContext, RelatedMailPage } from "../../contracts";
import { readApiError } from "./api-response";
import { createContact, listWritableContactBooks } from "./contact-capabilities";
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
  let disposed = false;

  const load = async (cursor?: string) => {
    controller?.abort();
    const currentController = new AbortController();
    controller = currentController;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].contacts[":bookId"][
        ":contactId"
      ].history.$get(
        {
          param: {
            mailboxId: props.mailboxId,
            conversationId: props.conversationId,
            bookId: props.bookId,
            contactId: props.contactId,
          },
          query: { limit: "10", cursor },
        },
        { init: { signal: currentController.signal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load related Mail"));
      const next = await response.json();
      if (disposed || controller !== currentController) return;
      setPage((current) => ({ items: cursor ? [...current.items, ...next.items] : next.items, nextCursor: next.nextCursor }));
    } catch (cause) {
      if (!disposed && controller === currentController && !isAbortError(cause)) {
        setError(cause instanceof Error ? cause.message : "Could not load related Mail");
      }
    } finally {
      if (!disposed && controller === currentController) {
        controller = null;
        setLoading(false);
      }
    }
  };

  onCleanup(() => {
    disposed = true;
    controller?.abort();
    controller = null;
  });

  return (
    <div class="mt-2">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        aria-expanded={open()}
        onClick={() => {
          const next = !open();
          setOpen(next);
          if (next && page().items.length === 0) void load();
        }}
      >
        <i class={`ti ${open() ? "ti-chevron-up" : "ti-history"}`} aria-hidden="true" /> Related Mail
      </Button>
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
            <Button
              variant="ghost"
              size="sm"
              type="button"
              class="mt-2"
              disabled={loading()}
              onClick={() => void load(page().nextCursor ?? undefined)}
            >
              Load more
            </Button>
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
  let controller: AbortController | null = null;
  let loadedConversationId: string | null = null;
  let loadGeneration = 0;

  const loadContacts = async (contactsCursor?: string): Promise<boolean> => {
    const currentController = new AbortController();
    controller = currentController;
    const generation = loadGeneration;
    const conversationId = props.conversationId;
    const isCurrent = () => controller === currentController && generation === loadGeneration && conversationId === props.conversationId;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].context.$get(
        {
          param: { mailboxId: props.mailboxId, conversationId },
          query: { contactsLimit: "50", contactsCursor },
        },
        { init: { signal: currentController.signal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load Contacts"));
      const next = await response.json();
      if (!isCurrent()) return false;
      setContext((current) => ({
        ...next,
        contacts:
          contactsCursor && current?.contacts.status === "ready" && next.contacts.status === "ready"
            ? { ...next.contacts, items: [...current.contacts.items, ...next.contacts.items] }
            : next.contacts,
      }));
      return true;
    } catch (cause) {
      if (isCurrent() && !isAbortError(cause)) {
        setError(cause instanceof Error ? cause.message : "Could not load Contacts");
      }
      return false;
    } finally {
      if (isCurrent()) {
        controller = null;
        setLoaded(true);
        setLoading(false);
      }
    }
  };

  createEffect(() => {
    if (!props.active) {
      loadGeneration += 1;
      controller?.abort();
      controller = null;
      return;
    }
    const conversationId = props.conversationId;
    if (loadedConversationId !== conversationId) {
      loadGeneration += 1;
      controller?.abort();
      controller = null;
      loadedConversationId = conversationId;
      setContext(null);
      setLoaded(false);
    }
    void loadContacts();
    onCleanup(() => controller?.abort());
  });

  onCleanup(() => {
    loadGeneration += 1;
    controller?.abort();
    controller = null;
  });

  const participantRows = createMemo(() => {
    const current = context();
    if (!current || current.contacts.status !== "ready") return [];
    return buildMailContactParticipantRows({
      participants: current.participants,
      contacts: current.contacts.items,
      matchedEmails: current.contacts.matchedEmails,
    });
  });

  const createParticipantContact = mutation.create<
    void,
    { participant: { email: string; displayName: string | null }; book: { id: string; name: string }; conversationId: string }
  >({
    mutation: async ({ participant, book, conversationId }, { abortSignal }) => {
      const result = await createContact(
        {
          bookId: book.id,
          label: participant.displayName || participant.email,
          emails: [{ label: "Email", email: participant.email }],
        },
        crypto.randomUUID(),
        abortSignal,
      );
      if (conversationId !== props.conversationId) return;
      const contact = result.data.contact;
      const openHref = result.links?.find((link) => link.rel === "edit" || link.rel === "open")?.href;
      setContext((current) => {
        if (!current || current.conversationId !== conversationId || current.contacts.status !== "ready") return current;
        return {
          ...current,
          contacts: {
            ...current.contacts,
            items: [
              ...current.contacts.items,
              {
                contactId: contact.id,
                bookId: contact.bookId,
                bookName: book.name,
                displayName: contact.displayName,
                companyName: contact.companyName,
                jobTitle: contact.jobTitle,
                matchedEmails: [participant.email],
                emails: contact.emails.slice(0, 20),
                phones: contact.phones.slice(0, 20),
                contactPointsTruncated: contact.emails.length > 20 || contact.phones.length > 20,
                openHref:
                  openHref ??
                  `/app/contacts/${encodeURIComponent(contact.bookId)}?contact=${encodeURIComponent(contact.id)}&contactBook=${encodeURIComponent(contact.bookId)}`,
                updatedAt: contact.updatedAt,
              },
            ],
            matchedEmails: [...new Set([...current.contacts.matchedEmails, participant.email])],
          },
        };
      });
    },
    onError: (error) => void prompts.error(error.message, { title: "Could not create contact" }),
  });

  const chooseBookAndCreate = async (participant: { email: string; displayName: string | null }) => {
    const selected = await prompts.search<{ id: string; name: string }>(
      async ({ query, abortSignal }) => {
        const result = await listWritableContactBooks({ query: query.trim() || undefined, limit: 25 }, abortSignal);
        return result.data.map((book) => ({
          value: { id: book.id, name: book.name },
          label: book.name,
          desc: book.description ?? undefined,
          icon: "ti ti-address-book",
        }));
      },
      {
        title: "Choose contact book",
        icon: "ti ti-address-book",
        placeholder: "Search writable contact books...",
        minQueryLength: 0,
        noResultsText: "No writable contact books found.",
        size: "small",
      },
    );
    if (!selected?.value) return;
    createParticipantContact.mutate({ participant, book: selected.value, conversationId: props.conversationId });
  };

  onCleanup(() => createParticipantContact.abort());

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
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  type="button"
                                  class="mt-2 w-full justify-center"
                                  disabled={createParticipantContact.loading()}
                                  onClick={() => void chooseBookAndCreate(participant)}
                                >
                                  <i class="ti ti-user-plus" aria-hidden="true" /> Create contact
                                </Button>
                              </Show>
                            }
                          >
                            <div class="mt-2 flex flex-col gap-3">
                              <For each={participant.contacts}>
                                {(contact) => (
                                  <div class="min-w-0">
                                    <a class="block truncate text-sm font-medium text-primary hover:underline" href={contact.openHref}>
                                      {contact.displayName}
                                    </a>
                                    <p class="truncate text-xs text-dimmed">
                                      {[contact.jobTitle, contact.companyName, contact.bookName].filter(Boolean).join(" · ")}
                                    </p>
                                    <Show when={contact.phones[0]}>
                                      {(phone) => (
                                        <a class="text-xs text-secondary hover:text-primary" href={`tel:${phone().phone}`}>
                                          {phone().phone}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    class="mt-3"
                    disabled={loading()}
                    onClick={() => void loadContacts(cursor())}
                  >
                    Load more
                  </Button>
                )}
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
