import { mutation, query } from "@k2b/stdlib/solid";
import { Button, DetailPanel, Disclosure, Placeholder, prompts } from "@k2b/ui";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { MailConversationContext, RelatedMailPage } from "../../contracts";
import { readApiError } from "./api-response";
import { createContact, listWritableContactBooks } from "./contact-capabilities";
import { buildMailContactParticipantRows } from "./mail-contact-context";

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
  const related = query.createInfinite<string, RelatedMailPage, string>({
    source: () => `${props.mailboxId}:${props.conversationId}:${props.bookId}:${props.contactId}`,
    enabled: open,
    loadPage: async (_source, { cursor, abortSignal }) => {
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
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load related Mail"));
      return response.json();
    },
    getNextCursor: (page) => page.nextCursor,
  });
  const relatedItems = createMemo(() => {
    const merged = new Map<string, RelatedMailPage["items"][number]>();
    for (const page of related.pages()) for (const item of page.items) merged.set(item.id, item);
    return [...merged.values()];
  });

  return (
    <Disclosure summary="Related Mail" icon="ti ti-history" class="mt-2" value={open} onValueChange={setOpen}>
      <Show
        when={!related.error()}
        fallback={
          <Placeholder
            state="error"
            variant="compact"
            align="left"
            title="Related Mail unavailable"
            description={related.error()?.message}
            action={
              <Button variant="secondary" size="xs" type="button" onClick={() => void related.refresh()}>
                Retry
              </Button>
            }
          />
        }
      >
        <Show
          when={!related.loading()}
          fallback={<Placeholder state="loading" variant="compact" align="left" title="Loading related Mail" />}
        >
          <Show
            when={relatedItems().length > 0}
            fallback={<Placeholder state="empty" variant="compact" align="left" icon="ti ti-mail-off" title="No related Mail" />}
          >
            <div class="flex flex-col gap-1">
              <For each={relatedItems()}>
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
          <Show when={related.hasMore()}>
            <Button
              variant="ghost"
              size="xs"
              type="button"
              class="mt-2"
              loading={related.loadingMore()}
              loadingLabel="Loading more"
              onClick={() => void related.loadMore()}
            >
              Load more
            </Button>
          </Show>
        </Show>
      </Show>
    </Disclosure>
  );
}

export default function MailConversationContext(props: {
  mailboxId: string;
  conversationId: string;
  active: boolean;
  onOpenHref: (href: string) => void | Promise<void>;
}) {
  const contexts = query.createInfinite<string, MailConversationContext, string>({
    source: () => props.conversationId,
    enabled: () => props.active,
    loadPage: async (conversationId, { cursor, abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].context.$get(
        {
          param: { mailboxId: props.mailboxId, conversationId },
          query: { contactsLimit: "50", contactsCursor: cursor },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load Contacts"));
      return response.json();
    },
    getNextCursor: (page) => (page.contacts.status === "ready" ? page.contacts.nextCursor : null),
  });
  const context = createMemo(() => {
    const [first, ...rest] = contexts.pages();
    if (!first || first.conversationId !== props.conversationId) return null;
    if (first.contacts.status !== "ready") return first;
    const contacts = new Map(first.contacts.items.map((contact) => [`${contact.bookId}:${contact.contactId}`, contact]));
    const matchedEmails = new Set(first.contacts.matchedEmails);
    let nextCursor = first.contacts.nextCursor;
    for (const page of rest) {
      if (page.conversationId !== props.conversationId) continue;
      if (page.contacts.status !== "ready") continue;
      for (const contact of page.contacts.items) contacts.set(`${contact.bookId}:${contact.contactId}`, contact);
      for (const email of page.contacts.matchedEmails) matchedEmails.add(email);
      nextCursor = page.contacts.nextCursor;
    }
    return { ...first, contacts: { ...first.contacts, items: [...contacts.values()], matchedEmails: [...matchedEmails], nextCursor } };
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
    { participant: { email: string; displayName: string | null }; book: { id: string; name: string }; conversationId: string },
    { idempotencyKey: string }
  >({
    onBefore: () => ({ idempotencyKey: crypto.randomUUID() }),
    mutation: async ({ participant, book, conversationId }, { abortSignal, idempotencyKey }) => {
      await createContact(
        {
          bookId: book.id,
          label: participant.displayName || participant.email,
          emails: [{ label: "Email", email: participant.email }],
        },
        idempotencyKey,
        abortSignal,
      );
      if (conversationId === props.conversationId) {
        try {
          await contexts.invalidate();
        } catch (error) {
          void prompts.error(error instanceof Error ? error.message : "Contacts could not be refreshed", {
            title: "Contact created",
          });
        }
      }
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
      <Show
        when={context()}
        fallback={
          <Show when={contexts.error()} fallback={<Placeholder state="loading" align="left" title="Loading contacts..." />}>
            {(error) => (
              <Placeholder
                state="error"
                align="left"
                title="Contacts unavailable"
                description={error().message}
                icon="ti ti-address-book-off"
                action={
                  <Button variant="secondary" size="sm" type="button" onClick={() => void contexts.refresh()}>
                    Retry
                  </Button>
                }
              />
            )}
          </Show>
        }
      >
        <Show
          when={!contexts.error()}
          fallback={
            <Placeholder
              state="error"
              align="left"
              title="Contacts unavailable"
              description={contexts.error()?.message ?? ""}
              icon="ti ti-address-book-off"
              action={
                <Button variant="secondary" size="sm" type="button" onClick={() => void contexts.refresh()}>
                  Retry
                </Button>
              }
            />
          }
        >
          <Show
            when={context()?.contacts.status === "ready"}
            fallback={
              <Placeholder
                state="error"
                align="left"
                title="Contacts unavailable"
                description="Contact context could not be refreshed."
                icon="ti ti-address-book-off"
                action={
                  <Button variant="secondary" size="sm" type="button" onClick={() => void contexts.refresh()}>
                    Retry
                  </Button>
                }
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
              <Show when={contexts.hasMore()}>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  class="mt-3"
                  loading={contexts.loadingMore()}
                  loadingLabel="Loading more"
                  onClick={() => void contexts.loadMore()}
                >
                  Load more
                </Button>
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
