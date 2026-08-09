import { mutation } from "@k2b/stdlib/solid";
import { Button, DetailPanel, Placeholder, prompts } from "@k2b/ui";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import { contactOpenHref } from "../../app-integration-contracts";
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
      <DetailPanel.Action
        type="button"
        aria-expanded={open()}
        onClick={() => {
          const next = !open();
          setOpen(next);
          if (next && page().items.length === 0) void load();
        }}
        leading={<i class="ti ti-history" aria-hidden="true" />}
        title="Related Mail"
        trailing={<i class={`ti ${open() ? "ti-chevron-up" : "ti-chevron-down"}`} aria-hidden="true" />}
      />
      <Show when={open()}>
        <Show when={!error()} fallback={<p class="mt-2 text-xs text-red-600 dark:text-red-300">{error()}</p>}>
          <Show
            when={page().items.length > 0}
            fallback={<p class="mt-2 text-xs text-dimmed">{loading() ? "Loading..." : "No related Mail"}</p>}
          >
            <div class="mt-2 flex flex-col gap-1">
              <For each={page().items}>
                {(item) => (
                  <DetailPanel.Action
                    type="button"
                    onClick={() => void props.onOpenHref(conversationHref(props.mailboxId, item.id))}
                    leading={<i class="ti ti-mail" aria-hidden="true" />}
                    title={item.subject || "(no subject)"}
                    description={item.participantSummary}
                    trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
                  />
                )}
              </For>
            </div>
          </Show>
          <Show when={page().nextCursor}>
            <Button
              variant="ghost"
              size="xs"
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
      const openHref = contactOpenHref(result.links);
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
                openHref,
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
    <div class="min-w-0">
      <Show when={loaded()} fallback={<Placeholder state="loading" align="left" title="Loading contacts..." />}>
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
              <div class="flex flex-col gap-2">
                <For each={participantRows()}>
                  {(participant) => (
                    <article class="min-w-0">
                      <Show
                        when={participant.contacts.length > 0}
                        fallback={
                          <Show
                            when={!participant.hasMatch}
                            fallback={
                              <div class="flex min-w-0 items-start gap-2 px-2 py-1.5">
                                <i class="ti ti-user mt-0.5 text-dimmed" aria-hidden="true" />
                                <div class="min-w-0 flex-1">
                                  <p class="truncate text-sm font-medium text-primary">{participant.displayName || participant.email}</p>
                                  <p class="truncate text-xs text-dimmed">Matching contact available. Load more to view it.</p>
                                </div>
                              </div>
                            }
                          >
                            <DetailPanel.Action
                              type="button"
                              disabled={createParticipantContact.loading()}
                              onClick={() => void chooseBookAndCreate(participant)}
                              leading={<i class="ti ti-user" aria-hidden="true" />}
                              title={participant.displayName || participant.email}
                              description={participant.displayName ? participant.email : undefined}
                              trailing={
                                <span class="flex items-center gap-1 text-xs">
                                  <i class="ti ti-user-plus" aria-hidden="true" /> Create
                                </span>
                              }
                            />
                          </Show>
                        }
                      >
                        <div class="flex flex-col gap-1">
                          <div class="px-2 py-1">
                            <p class="truncate text-xs font-medium text-secondary">{participant.displayName || participant.email}</p>
                            <Show when={participant.displayName}>
                              <p class="truncate text-xs text-dimmed" title={participant.email}>
                                {participant.email}
                              </p>
                            </Show>
                          </div>
                          <For each={participant.contacts}>
                            {(contact) => {
                              const description = () =>
                                [contact.jobTitle, contact.companyName, contact.bookName].filter(Boolean).join(" · ");
                              return (
                                <div class="min-w-0">
                                  <Show
                                    when={contact.openHref}
                                    fallback={
                                      <div class="flex min-w-0 items-start gap-2 px-2 py-1.5">
                                        <i class="ti ti-address-book mt-0.5 text-dimmed" aria-hidden="true" />
                                        <div class="min-w-0 flex-1">
                                          <p class="truncate text-sm font-medium text-primary">{contact.displayName}</p>
                                          <Show when={description()}>
                                            <p class="truncate text-xs text-dimmed">{description()}</p>
                                          </Show>
                                        </div>
                                      </div>
                                    }
                                  >
                                    {(href) => (
                                      <DetailPanel.Action
                                        href={href()}
                                        leading={<i class="ti ti-address-book" aria-hidden="true" />}
                                        title={contact.displayName}
                                        description={description() || undefined}
                                        trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
                                      />
                                    )}
                                  </Show>
                                  <Show when={contact.phones[0]}>
                                    {(phone) => (
                                      <DetailPanel.Action
                                        href={`tel:${phone().phone}`}
                                        leading={<i class="ti ti-phone" aria-hidden="true" />}
                                        title={phone().phone}
                                        description="Phone"
                                      />
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
                              );
                            }}
                          </For>
                        </div>
                      </Show>
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
    </div>
  );
}
