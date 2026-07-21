import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { Placeholder, Tooltip, toast } from "@valentinkolb/cloud/ui";
import {
  CONTACTS_LIVE_WS_TYPE,
  type ContactLiveClientMessage,
  type ContactLiveServerMessage,
  parseContactLiveServerMessage,
} from "@valentinkolb/cloud-app-contacts/integration";
import {
  parseSpaceLiveServerMessage,
  SPACE_LIVE_WS_TYPE,
  type SpaceLiveClientMessage,
  type SpaceLiveServerMessage,
} from "@valentinkolb/cloud-app-spaces/integration";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import {
  conversationSpaceMutationSchema,
  type MailConversationContext,
  mailConversationContextSchema,
  mailSpaceCandidatesResponseSchema,
  type RelatedMailPage,
  relatedMailPageSchema,
} from "../../contracts";
import { readApiError } from "./api-response";

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

const conversationHref = (mailboxId: string, conversationId: string): string => {
  const url = new URL(window.location.href);
  url.pathname = `/app/mail/${mailboxId}`;
  url.searchParams.set("conversation", conversationId);
  url.searchParams.delete("message");
  return `${url.pathname}${url.search}`;
};

function RelatedMail(props: { mailboxId: string; conversationId: string; bookId: string; contactId: string }) {
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
            <div class="mt-2 flex flex-col divide-y divide-subtle">
              <For each={page().items}>
                {(item) => (
                  <a class="py-2 text-xs hover:text-primary" href={conversationHref(props.mailboxId, item.id)}>
                    <span class="block truncate font-medium text-primary">{item.subject || "(no subject)"}</span>
                    <span class="block truncate text-dimmed">{item.participantSummary}</span>
                  </a>
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
  revision: number;
  onRevision: (revision: number) => void;
}) {
  const [context, setContext] = createSignal<MailConversationContext | null>(null);
  const [contactsLoading, setContactsLoading] = createSignal(false);
  const [contactsLoaded, setContactsLoaded] = createSignal(false);
  const [contactsError, setContactsError] = createSignal<string | null>(null);
  const [, setSpacesLoading] = createSignal(false);
  const [spacesLoaded, setSpacesLoaded] = createSignal(false);
  const [spacesError, setSpacesError] = createSignal<string | null>(null);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [candidateSearch, setCandidateSearch] = createSignal("");
  const [candidateAppliedSearch, setCandidateAppliedSearch] = createSignal("");
  const [candidates, setCandidates] = createSignal<ReturnType<typeof mailSpaceCandidatesResponseSchema.parse>>({
    items: [],
    nextCursor: null,
  });
  const [candidateError, setCandidateError] = createSignal<string | null>(null);
  const [candidateLoading, setCandidateLoading] = createSignal(false);
  const [mutatingLinkId, setMutatingLinkId] = createSignal<string | null>(null);
  const [contactsLiveEpoch, setContactsLiveEpoch] = createSignal(0);
  let contactsController: AbortController | null = null;
  let spacesController: AbortController | null = null;
  let candidateController: AbortController | null = null;
  let linkMutationPending = false;
  let loadedConversationId: string | null = null;
  const linkedSpaceIds = createMemo(
    () =>
      new Set(context()?.spaces.status === "ready" ? context()!.spaces.links.flatMap((link) => (link.space ? [link.space.id] : [])) : []),
  );
  const liveScope = createMemo(() => {
    const current = context();
    if (!props.active || !current) return null;
    const spaceIds = current.spaces.status === "ready" ? current.spaces.links.flatMap((link) => (link.space ? [link.space.id] : [])) : [];
    return JSON.stringify({ conversationId: props.conversationId, spaceIds: spaceIds.toSorted() });
  });

  const loadContacts = async (contactsCursor?: string): Promise<boolean> => {
    contactsController?.abort();
    const controller = new AbortController();
    contactsController = controller;
    setContactsLoading(true);
    setContactsError(null);
    try {
      const query = new URLSearchParams({ section: "contacts", contactsLimit: "25" });
      if (contactsCursor) query.set("contactsCursor", contactsCursor);
      const response = await fetch(`/api/mail/mailboxes/${props.mailboxId}/conversations/${props.conversationId}/context?${query}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not load Contacts"));
      const next = mailConversationContextSchema.parse(await response.json());
      setContext((current) => ({
        ...next,
        contacts:
          contactsCursor && current?.contacts.status === "ready" && next.contacts.status === "ready"
            ? { ...next.contacts, items: [...current.contacts.items, ...next.contacts.items] }
            : next.contacts,
        spaces: current?.spaces ?? next.spaces,
      }));
      return true;
    } catch (cause) {
      if (!isAbortError(cause)) setContactsError(cause instanceof Error ? cause.message : "Could not load Contacts");
      return false;
    } finally {
      if (contactsController === controller) {
        setContactsLoaded(true);
        setContactsLoading(false);
      }
    }
  };

  const loadSpaces = async (): Promise<boolean> => {
    spacesController?.abort();
    const controller = new AbortController();
    spacesController = controller;
    setSpacesLoading(true);
    setSpacesError(null);
    try {
      const query = new URLSearchParams({ section: "spaces", contactsLimit: "25" });
      const response = await fetch(`/api/mail/mailboxes/${props.mailboxId}/conversations/${props.conversationId}/context?${query}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not load Spaces"));
      const next = mailConversationContextSchema.parse(await response.json());
      setContext((current) => ({ ...next, contacts: current?.contacts ?? next.contacts }));
      return true;
    } catch (cause) {
      if (!isAbortError(cause)) setSpacesError(cause instanceof Error ? cause.message : "Could not load Spaces");
      return false;
    } finally {
      if (spacesController === controller) {
        setSpacesLoaded(true);
        setSpacesLoading(false);
      }
    }
  };

  const loadCandidates = async (cursor?: string) => {
    candidateController?.abort();
    const controller = new AbortController();
    candidateController = controller;
    setCandidateLoading(true);
    setCandidateError(null);
    try {
      const query = new URLSearchParams({ limit: "25" });
      const search = cursor ? candidateAppliedSearch() : candidateSearch().trim();
      if (!cursor) setCandidateAppliedSearch(search);
      if (search) query.set("q", search);
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(
        `/api/mail/mailboxes/${props.mailboxId}/conversations/${props.conversationId}/spaces/candidates?${query}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load Spaces"));
      const next = mailSpaceCandidatesResponseSchema.parse(await response.json());
      setCandidates((current) => ({ items: cursor ? [...current.items, ...next.items] : next.items, nextCursor: next.nextCursor }));
    } catch (cause) {
      if (!isAbortError(cause)) setCandidateError(cause instanceof Error ? cause.message : "Could not load Spaces");
    } finally {
      if (candidateController === controller) setCandidateLoading(false);
    }
  };

  const linkSpace = async (spaceId: string) => {
    if (linkMutationPending) return;
    const current = context();
    if (!current) return;
    linkMutationPending = true;
    setMutatingLinkId(spaceId);
    try {
      const response = await fetch(`/api/mail/mailboxes/${props.mailboxId}/conversations/${props.conversationId}/spaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, expectedRevision: current.conversationRevision }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not link Space"));
      const mutation = conversationSpaceMutationSchema.parse(await response.json());
      props.onRevision(mutation.conversationRevision);
      setPickerOpen(false);
      await loadSpaces();
      toast.success("Space linked");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not link Space");
    } finally {
      linkMutationPending = false;
      if (mutatingLinkId() === spaceId) setMutatingLinkId(null);
    }
  };

  const unlinkSpace = async (linkId: string) => {
    if (linkMutationPending) return;
    const current = context();
    if (!current) return;
    linkMutationPending = true;
    setMutatingLinkId(linkId);
    try {
      const response = await fetch(`/api/mail/mailboxes/${props.mailboxId}/conversations/${props.conversationId}/spaces/${linkId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: current.conversationRevision }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not unlink Space"));
      const mutation = conversationSpaceMutationSchema.parse(await response.json());
      props.onRevision(mutation.conversationRevision);
      await loadSpaces();
      toast.success("Space unlinked");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not unlink Space");
    } finally {
      linkMutationPending = false;
      if (mutatingLinkId() === linkId) setMutatingLinkId(null);
    }
  };

  createEffect(() => {
    if (!props.active) {
      contactsController?.abort();
      spacesController?.abort();
      candidateController?.abort();
      return;
    }
    const conversationId = props.conversationId;
    props.revision;
    if (loadedConversationId !== conversationId) {
      loadedConversationId = conversationId;
      setContext(null);
      setContactsLoaded(false);
      setSpacesLoaded(false);
    }
    void loadContacts();
    void loadSpaces();
    onCleanup(() => {
      contactsController?.abort();
      spacesController?.abort();
    });
  });

  createEffect(() => {
    if (!liveScope()) return;
    contactsLiveEpoch();
    const current = untrack(context);
    if (!current) return;
    const connections: Array<{ dispose: () => void }> = [];
    const contacts = createLiveWebSocket<ContactLiveServerMessage>({
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
          void loadContacts().then((applied) => applied && controls.markApplied(message.payload.cursor));
        } else if (message.type === CONTACTS_LIVE_WS_TYPE.event) {
          void loadContacts().then((applied) => applied && controls.markApplied(message.payload.cursor));
        } else if (message.type === CONTACTS_LIVE_WS_TYPE.scopeChanged) {
          controls.terminate({ code: "contacts_changed", message: "Contacts access changed" });
          void loadContacts().finally(() => setContactsLiveEpoch((epoch) => epoch + 1));
        } else if (message.type === CONTACTS_LIVE_WS_TYPE.revoked) {
          controls.terminate({ code: "contacts_revoked", message: "Contacts access was revoked" });
          void loadContacts();
        }
      },
    });
    contacts.connect();
    connections.push(contacts);

    if (current.spaces.status === "ready") {
      for (const link of current.spaces.links) {
        if (!link.space) continue;
        const spaceId = link.space.id;
        const connection = createLiveWebSocket<SpaceLiveServerMessage>({
          url: "/api/spaces/ws",
          initialCursor: null,
          activity: "visible",
          subscribe: (cursor) =>
            ({ type: SPACE_LIVE_WS_TYPE.subscribe, payload: { spaceId, fromCursor: cursor } }) satisfies SpaceLiveClientMessage,
          parse: parseSpaceLiveServerMessage,
          onMessage: (message, controls) => {
            if (message.type === SPACE_LIVE_WS_TYPE.ready) {
              void loadSpaces().then((applied) => applied && controls.markApplied(message.payload.cursor));
            } else if (message.type === SPACE_LIVE_WS_TYPE.event) {
              void loadSpaces().then((applied) => applied && controls.markApplied(message.payload.cursor));
            } else if (message.type === SPACE_LIVE_WS_TYPE.revoked) {
              controls.terminate({ code: message.payload.code, message: message.payload.message });
              void loadSpaces();
            }
          },
        });
        connection.connect();
        connections.push(connection);
      }
    }
    onCleanup(() => connections.forEach((connection) => connection.dispose()));
  });

  onCleanup(() => {
    contactsController?.abort();
    spacesController?.abort();
    candidateController?.abort();
  });

  return (
    <>
      <section class="detail-section">
        <h3 class="detail-section-label">Contacts</h3>
        <Show when={contactsLoaded()} fallback={<p class="text-xs text-dimmed">Loading contacts...</p>}>
          <Show
            when={!contactsError()}
            fallback={<Placeholder title="Contacts unavailable" description={contactsError() ?? ""} icon="ti ti-address-book-off" />}
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
              <Show
                when={context()?.contacts.status === "ready" && context()!.contacts.items.length > 0}
                fallback={<Placeholder title="No matching contacts" description="" icon="ti ti-address-book" />}
              >
                <div class="flex flex-col divide-y divide-subtle">
                  <For each={context()?.contacts.status === "ready" ? context()!.contacts.items : []}>
                    {(contact) => (
                      <article class="py-3 first:pt-0 last:pb-0">
                        <div class="flex min-w-0 items-start gap-2">
                          <i class="ti ti-user mt-0.5 text-dimmed" aria-hidden="true" />
                          <div class="min-w-0 flex-1">
                            <a class="block truncate text-sm font-medium text-primary hover:underline" href={contact.href}>
                              {contact.displayName}
                            </a>
                            <Show when={contact.companyName || contact.jobTitle}>
                              <p class="truncate text-xs text-dimmed">
                                {[contact.jobTitle, contact.companyName].filter(Boolean).join(" · ")}
                              </p>
                            </Show>
                            <p class="truncate text-xs text-secondary" title={contact.matchedEmails.join(", ")}>
                              {contact.matchedEmails.join(", ")}
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
                            />
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
                      disabled={contactsLoading()}
                      onClick={() => void loadContacts(cursor())}
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

      <section class="detail-section">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h3 class="detail-section-label mb-0">Spaces</h3>
          <Show when={context()?.canWrite}>
            <Tooltip content="Link Space">
              <button
                type="button"
                class="icon-btn"
                aria-label="Link Space"
                disabled={mutatingLinkId() !== null}
                onClick={() => {
                  const next = !pickerOpen();
                  setPickerOpen(next);
                  if (next) void loadCandidates();
                }}
              >
                <i class="ti ti-link-plus" aria-hidden="true" />
              </button>
            </Tooltip>
          </Show>
        </div>
        <Show when={spacesLoaded()} fallback={<p class="text-xs text-dimmed">Loading Spaces...</p>}>
          <Show
            when={!spacesError() && context()?.spaces.status !== "unavailable"}
            fallback={<Placeholder title="Spaces unavailable" description={spacesError() ?? ""} icon="ti ti-layout-kanban" />}
          >
            <Show
              when={(context()?.spaces.links.length ?? 0) > 0}
              fallback={<Placeholder title="No linked Spaces" description="" icon="ti ti-layout-kanban" />}
            >
              <div class="flex flex-col divide-y divide-subtle">
                <For each={context()?.spaces.links ?? []}>
                  {(link) => (
                    <div class="flex min-w-0 items-center gap-2 py-2 first:pt-0 last:pb-0">
                      <span class="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ "background-color": link.space?.color ?? "#6b7280" }} />
                      <Show when={link.space} fallback={<span class="min-w-0 flex-1 truncate text-sm text-dimmed">Space unavailable</span>}>
                        {(space) => (
                          <a class="min-w-0 flex-1 truncate text-sm text-primary hover:underline" href={space().href}>
                            {space().name}
                          </a>
                        )}
                      </Show>
                      <Show when={context()?.canWrite}>
                        <Tooltip content="Unlink Space">
                          <button
                            type="button"
                            class="icon-btn"
                            aria-label="Unlink Space"
                            disabled={mutatingLinkId() !== null}
                            onClick={() => void unlinkSpace(link.linkId)}
                          >
                            <i class="ti ti-unlink" aria-hidden="true" />
                          </button>
                        </Tooltip>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>

        <Show when={pickerOpen()}>
          <div class="mt-3 border-t border-subtle pt-3">
            <form
              class="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void loadCandidates();
              }}
            >
              <input
                class="input min-w-0 flex-1"
                type="search"
                value={candidateSearch()}
                onInput={(event) => setCandidateSearch(event.currentTarget.value)}
                placeholder="Search Spaces"
                aria-label="Search Spaces"
              />
              <button type="submit" class="icon-btn" aria-label="Search Spaces">
                <i class="ti ti-search" aria-hidden="true" />
              </button>
            </form>
            <Show when={!candidateError()} fallback={<p class="mt-2 text-xs text-red-600 dark:text-red-300">{candidateError()}</p>}>
              <div class="mt-2 flex max-h-56 flex-col overflow-y-auto">
                <For each={candidates().items}>
                  {(space) => {
                    const linked = () => linkedSpaceIds().has(space.id);
                    return (
                      <button
                        type="button"
                        class="flex min-w-0 items-center gap-2 px-1 py-2 text-left hover:bg-subtle disabled:cursor-default disabled:opacity-60"
                        disabled={linked() || mutatingLinkId() !== null}
                        onClick={() => void linkSpace(space.id)}
                      >
                        <span class="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ "background-color": space.color ?? "#6b7280" }} />
                        <span class="min-w-0 flex-1 truncate text-sm text-primary">{space.name}</span>
                        <Show when={linked()}>
                          <span class="badge badge-sm">Linked</span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
                <Show when={candidates().items.length === 0 && !candidateLoading()}>
                  <p class="py-3 text-center text-xs text-dimmed">No Spaces found</p>
                </Show>
              </div>
              <Show when={candidates().nextCursor}>
                {(cursor) => (
                  <button
                    type="button"
                    class="btn-simple btn-xs mt-2"
                    disabled={candidateLoading()}
                    onClick={() => void loadCandidates(cursor())}
                  >
                    Load more
                  </button>
                )}
              </Show>
            </Show>
          </div>
        </Show>
      </section>
    </>
  );
}
