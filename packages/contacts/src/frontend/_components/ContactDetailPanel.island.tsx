import { mutation as mutations } from "@k2b/stdlib/solid";
import { Avatar, Button, ButtonLink, DescriptionList, DetailPanel, Dropdown, IconButton, Placeholder, Tooltip } from "@k2b/ui";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Contact, ContactNote, ContactRef, ContactTree } from "../../service";
import { resolveContactInitials, resolveContactName, safeWebsiteHref } from "../../shared";
import { readErrorMessage } from "./api";
import { createContactDetailActions } from "./ContactDetailPanel.actions";
import ContactFavoriteButton from "./ContactFavoriteButton";
import ContactNotesSection from "./ContactNotesSection";
import ContactOrgTreeView from "./ContactOrgTreeView";
import ContactQuickEdit from "./ContactQuickEdit";
import ContactTagChip from "./ContactTagChip";
import { contactFavoriteKey, listenForContactFavoriteChanges } from "./contacts-favorites";
import { listenForContactsLiveInvalidation, requiresSelectedContactRefresh } from "./contacts-live";
import {
  CONTACT_DETAIL_EVENT,
  type ContactDetailPayload,
  clearSelectedContactInUrl,
  getSelectedContactFromUrl,
  requestContactNoteComposer,
  setSelectedContactInUrl,
} from "./context";

type Props = {
  initialContact: Contact | null;
  initialContactId: string | null;
  initialBookId: string | null;
  initialNotes: ContactNote[];
  contacts: Contact[];
  bookNames: Record<string, string>;
  writableBooks: Array<{ id: string; name: string }>;
  /** Books where the current user is an admin (controls e.g. note deletion). */
  adminBookIds: string[];
  currentUserId: string;
  showEmpty?: boolean;
  initialFavoriteKeys: string[];
};

const formatBirthday = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-DE");
};

const formatAddress = (address: Contact["addresses"][number]) => {
  const cityLine = [address.postalCode, address.city].filter(Boolean).join(" ");
  const regionLine = [address.stateRegion, address.countryCode].filter(Boolean).join(" · ");
  return [address.recipientName, address.companyName, address.line1, address.line2, cityLine, regionLine].filter(Boolean) as string[];
};

export default function ContactDetailPanel(props: Props) {
  const [contact, setContact] = createSignal<Contact | null>(props.initialContact);
  const [contactId, setContactId] = createSignal<string | null>(props.initialContactId);
  const [bookId, setBookId] = createSignal<string | null>(props.initialBookId);
  const [detailMode, setDetailMode] = createSignal<"details" | "tree">("details");
  const [quickEditing, setQuickEditing] = createSignal(false);
  const [orgTree, setOrgTree] = createSignal<ContactTree | null>(null);
  const [selectedFavorite, setSelectedFavorite] = createSignal(
    props.initialContact
      ? props.initialFavoriteKeys.includes(contactFavoriteKey(props.initialContact.bookId, props.initialContact.id))
      : false,
  );

  const detailMutation = mutations.create<
    { contact: Contact | null; favorite?: boolean },
    { bookId: string; contactId: string; selectedBookId: string; loadFavorite?: boolean },
    { target: { bookId: string; contactId: string; selectedBookId: string; loadFavorite?: boolean } }
  >({
    onBefore: (target) => ({ target }),
    mutation: async (target, ctx) => {
      const response = await apiClient.books[":bookId"].contacts[":contactId"].$get(
        { param: target },
        { init: { signal: ctx.abortSignal } },
      );
      if (response.status === 403 || response.status === 404) return { contact: null };
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to refresh contact"));
      const contact = await response.json();
      if (!target.loadFavorite) return { contact };
      const favoriteResponse = await apiClient.favorites[":bookId"][":contactId"].$get({ param: target });
      if (!favoriteResponse.ok) throw new Error(await readErrorMessage(favoriteResponse, "Failed to load favorite state"));
      return { contact, favorite: (await favoriteResponse.json()).favorite };
    },
    onSuccess: (result, ctx) => {
      const target = ctx?.target;
      if (!target || contactId() !== target.contactId || bookId() !== target.selectedBookId) return;
      const updated = result.contact;
      if (!updated) {
        clearSelectedContactInUrl("replace");
        return;
      }
      if (result.favorite !== undefined) setSelectedFavorite(result.favorite);
      setContact(updated);
      setContactId(updated.id);
      setBookId(updated.bookId);
      setOrgTree(null);
      if (updated.bookId !== target.selectedBookId) {
        setSelectedContactInUrl({ contactId: updated.id, bookId: updated.bookId, contact: updated, history: "replace" });
      }
    },
  });

  const refreshSelectedContact = async (targetBookId?: string) => {
    const selectedContactId = contactId();
    const selectedBookId = bookId();
    if (!selectedContactId || !selectedBookId) return;
    await detailMutation.mutate({ bookId: targetBookId ?? selectedBookId, contactId: selectedContactId, selectedBookId });
    if (detailMutation.error()) throw detailMutation.error();
  };

  const retrySelectedContact = () => {
    const selectedContactId = contactId();
    const selectedBookId = bookId();
    if (!selectedContactId || !selectedBookId) return;
    void detailMutation.mutate({
      bookId: selectedBookId,
      contactId: selectedContactId,
      selectedBookId,
      loadFavorite: true,
    });
  };

  const findContact = (id: string | null, selectedBookId: string | null) => {
    if (!id || !selectedBookId) return null;
    const found = props.contacts.find((item) => item.id === id && item.bookId === selectedBookId);
    if (found) return found;
    if (props.initialContact && props.initialContact.id === id && props.initialContact.bookId === selectedBookId) {
      return props.initialContact;
    }
    return null;
  };

  const syncFromUrl = () => {
    const selected = getSelectedContactFromUrl();
    const found = findContact(selected.contactId, selected.bookId);
    setContact(found);
    setContactId(selected.contactId);
    setBookId(selected.bookId);
    setSelectedFavorite(found ? props.initialFavoriteKeys.includes(contactFavoriteKey(found.bookId, found.id)) : false);
    setDetailMode("details");
    setQuickEditing(false);
    setOrgTree(null);
    if (selected.contactId && selected.bookId && !found) {
      void detailMutation.mutate({
        bookId: selected.bookId,
        contactId: selected.contactId,
        selectedBookId: selected.bookId,
        loadFavorite: true,
      });
    }
  };

  onMount(() => {
    const handleSelect = (event: Event) => {
      const payload = (event as CustomEvent<ContactDetailPayload>).detail;
      const found = payload.item ?? findContact(payload.itemKey, payload.bookId);
      setContact(found);
      setContactId(payload.itemKey);
      setBookId(payload.bookId);
      setSelectedFavorite(
        payload.favorite ??
          (payload.item ? props.initialFavoriteKeys.includes(contactFavoriteKey(payload.item.bookId, payload.item.id)) : false),
      );
      setDetailMode("details");
      setQuickEditing(false);
      setOrgTree(null);
      if (payload.itemKey && payload.bookId && !found) {
        void detailMutation.mutate({
          bookId: payload.bookId,
          contactId: payload.itemKey,
          selectedBookId: payload.bookId,
          loadFavorite: true,
        });
      }
    };

    const handlePopState = () => syncFromUrl();
    const stopFavoriteChanges = listenForContactFavoriteChanges((change) => {
      if (change.contactId === contactId() && change.bookId === bookId()) setSelectedFavorite(change.favorite);
    });

    window.addEventListener(CONTACT_DETAIL_EVENT, handleSelect);
    window.addEventListener("popstate", handlePopState);
    const stopLiveInvalidations = listenForContactsLiveInvalidation((event) => {
      const selectedContactId = contactId();
      const selectedBookId = bookId();
      if (!selectedContactId || !selectedBookId) return;
      if (event.type === "contact.deleted" && event.contactId === selectedContactId && event.bookId === selectedBookId) {
        clearSelectedContactInUrl("replace");
        return;
      }
      if (event.type === "contact.moved" && event.contactId === selectedContactId && event.sourceBookId === selectedBookId) {
        return refreshSelectedContact(event.targetBookId);
      }
      if (requiresSelectedContactRefresh(event, selectedBookId)) {
        return refreshSelectedContact();
      }
    });

    onCleanup(() => {
      stopLiveInvalidations();
      stopFavoriteChanges();
      window.removeEventListener(CONTACT_DETAIL_EVENT, handleSelect);
      window.removeEventListener("popstate", handlePopState);
    });
  });

  const actions = createContactDetailActions({
    bookId,
    writableBooks: props.writableBooks,
    orgTree,
    setOrgTree,
    setDetailMode,
  });

  return (
    <Show
      when={contact()}
      fallback={
        <Show
          when={detailMutation.error()}
          fallback={
            <Show
              when={detailMutation.loading()}
              fallback={
                props.showEmpty === false ? null : (
                  <Placeholder icon="ti ti-id" class="h-full min-h-0 justify-center" description={<>Select a contact to see details</>} />
                )
              }
            >
              <Placeholder state="loading" variant="panel" class="h-full min-h-0 justify-center" title="Loading contact" />
            </Show>
          }
        >
          {(error) => (
            <Placeholder
              state="error"
              variant="panel"
              align="left"
              class="h-full min-h-0 justify-center"
              title="Could not load contact"
              description={error().message}
              action={
                <Button variant="secondary" size="sm" onClick={retrySelectedContact}>
                  Try again
                </Button>
              }
            />
          )}
        </Show>
      }
    >
      {(selectedContact) => {
        const c = selectedContact;
        const hasReach = () => c().emails.length > 0 || c().phones.length > 0 || c().websites.length > 0;
        const hasPrimaryActions = () => !!(c().emails[0] || c().phones[0] || actions.canEdit());
        const hasWork = () => !!(c().companyName || c().department || c().jobTitle || c().vatId);
        const hasFormalName = () => !!(c().label && (c().firstName || c().lastName));
        const hasPersonal = () => hasFormalName() || !!(c().birthday || c().salutation || c().pronouns || c().preferredLanguage);
        const hasOrgTree = () => c().parentContactId !== null || c().members.length > 0;
        const hasContactInformation = () => hasReach() || c().addresses.length > 0;
        const hasAdditionalDetails = () => c().bankAccounts.length > 0 || hasPersonal() || hasWork();
        const hasOrganization = () => !!(c().parent || hasOrgTree() || actions.canEdit());
        const keyDetailItems = () => [
          {
            term: "Name",
            description: [c().firstName, c().lastName].filter(Boolean).join(" ") || resolveContactName(c()),
          },
          ...(c().companyName ? [{ term: "Company", description: c().companyName }] : []),
          ...(c().jobTitle ? [{ term: "Job title", description: c().jobTitle }] : []),
          { term: "Book", description: props.bookNames[c().bookId] ?? c().bookId },
          ...(c().tags.length > 0
            ? [
                {
                  term: "Tags",
                  description: (
                    <span class="flex flex-wrap gap-1.5">
                      <For each={c().tags}>{(tag) => <ContactTagChip name={tag.name} color={tag.color} size="sm" />}</For>
                    </span>
                  ),
                },
              ]
            : []),
        ];
        return (
          <Show
            when={detailMode() === "tree" && orgTree()}
            fallback={
              <DetailPanel>
                <DetailPanel.Header
                  leading={<Avatar name={resolveContactName(c())} fallback={resolveContactInitials(c())} size="sm" />}
                  title={resolveContactName(c())}
                  subtitle={[c().jobTitle, c().companyName, props.bookNames[c().bookId]].filter(Boolean).join(" · ")}
                  primaryActions={
                    hasPrimaryActions() ? (
                      <nav aria-label="Contact actions" class="flex flex-wrap gap-2">
                        <Show when={c().emails[0]}>
                          {(email) => (
                            <ButtonLink href={`mailto:${email().email}`} variant="secondary" size="sm">
                              <i class="ti ti-mail" aria-hidden="true" /> Email
                            </ButtonLink>
                          )}
                        </Show>
                        <Show when={c().phones[0]}>
                          {(phone) => (
                            <ButtonLink href={`tel:${phone().phone}`} variant="secondary" size="sm">
                              <i class="ti ti-phone" aria-hidden="true" /> Call
                            </ButtonLink>
                          )}
                        </Show>
                        <Show when={actions.canEdit()}>
                          <Button variant="secondary" size="sm" onClick={() => requestContactNoteComposer(c().id)}>
                            <i class="ti ti-note" aria-hidden="true" /> Note
                          </Button>
                        </Show>
                      </nav>
                    ) : undefined
                  }
                  actions={
                    <>
                      <ContactFavoriteButton bookId={c().bookId} contactId={c().id} initialFavorite={selectedFavorite()} />
                      <Dropdown.Root
                        position="bottom-left"
                        items={[
                          {
                            label: "Download vCard",
                            icon: "ti ti-download",
                            href: `/api/contacts/books/${encodeURIComponent(c().bookId)}/contacts/${encodeURIComponent(c().id)}/export.vcf`,
                          },
                          ...(actions.canEdit()
                            ? [
                                {
                                  label: "Edit all fields",
                                  icon: "ti ti-pencil",
                                  action: () => actions.openEditDialog(c()),
                                },
                              ]
                            : []),
                          ...(actions.canMove()
                            ? [
                                {
                                  label: "Move to another book",
                                  icon: "ti ti-folder-symlink",
                                  action: () => actions.moveToBook(c()),
                                },
                              ]
                            : []),
                        ]}
                      >
                        <Dropdown.Trigger iconOnly label="More contact actions" tooltip="More contact actions">
                          <i class="ti ti-dots" aria-hidden="true" />
                        </Dropdown.Trigger>
                      </Dropdown.Root>
                      <IconButton label="Close contact detail panel" onClick={() => clearSelectedContactInUrl()}>
                        <i class="ti ti-x" aria-hidden="true" />
                      </IconButton>
                    </>
                  }
                />

                <DetailPanel.Body scrollPreserveKey="contacts-detail">
                  <DetailPanel.Summary
                    title="Overview"
                    actions={
                      actions.canEdit() && !quickEditing() ? (
                        <Button variant="ghost" size="sm" onClick={() => setQuickEditing(true)}>
                          <i class="ti ti-pencil" aria-hidden="true" /> Quick edit
                        </Button>
                      ) : undefined
                    }
                  >
                    <Show when={quickEditing()} fallback={<DescriptionList layout="rows" size="sm" items={keyDetailItems()} />}>
                      <ContactQuickEdit
                        contact={c()}
                        onCancel={() => setQuickEditing(false)}
                        onSaved={(updated) => {
                          setContact(updated);
                          setQuickEditing(false);
                          setSelectedContactInUrl({
                            contactId: updated.id,
                            bookId: updated.bookId,
                            contact: updated,
                          });
                        }}
                        onEditAll={() => {
                          setQuickEditing(false);
                          void actions.openEditDialog(c());
                        }}
                      />
                    </Show>
                  </DetailPanel.Summary>

                  <Show when={hasContactInformation()}>
                    <DetailPanel.Group label="Contact information">
                      <Show when={hasReach()}>
                        <DetailPanel.Section title="Reach" icon="ti ti-at" tone="accent">
                          <div class="flex flex-col gap-1">
                            <For each={c().emails}>
                              {(email) => (
                                <DetailPanel.Action
                                  href={`mailto:${email.email}`}
                                  leading={<i class="ti ti-mail" aria-hidden="true" />}
                                  title={<span class="break-all">{email.email}</span>}
                                  description={email.label ?? "Email"}
                                />
                              )}
                            </For>
                            <For each={c().phones}>
                              {(phone) => (
                                <DetailPanel.Action
                                  href={`tel:${phone.phone}`}
                                  leading={<i class="ti ti-phone" aria-hidden="true" />}
                                  title={phone.phone}
                                  description={phone.label ?? "Phone"}
                                />
                              )}
                            </For>
                            <For each={c().websites}>
                              {(website) => (
                                <Show
                                  when={safeWebsiteHref(website.url)}
                                  fallback={
                                    <div class="flex min-w-0 items-start gap-3 px-2 py-2 text-sm">
                                      <i class="ti ti-world mt-0.5 shrink-0 text-dimmed" aria-hidden="true" />
                                      <span class="min-w-0">
                                        <span class="block break-all text-secondary">{website.url}</span>
                                        <span class="block text-xs text-dimmed">{website.label ?? "Website"}</span>
                                      </span>
                                    </div>
                                  }
                                >
                                  {(href) => (
                                    <DetailPanel.Action
                                      href={href()}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      leading={<i class="ti ti-world" aria-hidden="true" />}
                                      title={<span class="break-all">{website.url}</span>}
                                      description={website.label ?? "Website"}
                                      trailing={<i class="ti ti-external-link" aria-hidden="true" />}
                                    />
                                  )}
                                </Show>
                              )}
                            </For>
                          </div>
                        </DetailPanel.Section>
                      </Show>

                      <Show when={c().addresses.length > 0}>
                        <DetailPanel.Section title="Addresses" icon="ti ti-map-pin" tone="neutral" collapsible>
                          <div class="flex flex-col gap-3">
                            <For each={c().addresses}>
                              {(address) => (
                                <div class="flex items-start gap-3 px-2 py-1 text-sm text-primary">
                                  <i class="ti ti-map-pin mt-0.5 shrink-0 text-dimmed" aria-hidden="true" />
                                  <div class="min-w-0 flex-1">
                                    <Show when={address.label}>
                                      <p class="text-xs text-dimmed">{address.label}</p>
                                    </Show>
                                    <For each={formatAddress(address)}>{(line) => <p class="leading-snug">{line}</p>}</For>
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </DetailPanel.Section>
                      </Show>
                    </DetailPanel.Group>
                  </Show>

                  <Show when={hasAdditionalDetails()}>
                    <DetailPanel.Group label="Additional details">
                      <Show when={c().bankAccounts.length > 0}>
                        <DetailPanel.Section title="Bank details" icon="ti ti-building-bank" tone="neutral" collapsible>
                          <div class="flex flex-col gap-3">
                            <For each={c().bankAccounts}>
                              {(account) => (
                                <div class="flex items-start gap-3 px-2 py-1 text-sm text-primary">
                                  <i class="ti ti-building-bank mt-0.5 shrink-0 text-dimmed" aria-hidden="true" />
                                  <div class="min-w-0 flex-1">
                                    <Show when={account.label}>
                                      <p class="text-xs text-dimmed">{account.label}</p>
                                    </Show>
                                    <p class="leading-snug">{account.accountHolderName}</p>
                                    <p class="break-all font-mono text-xs leading-snug">{account.iban}</p>
                                    <Show when={account.bic || account.bankName}>
                                      <p class="text-xs leading-snug text-dimmed">
                                        {[account.bankName, account.bic].filter(Boolean).join(" · ")}
                                      </p>
                                    </Show>
                                    <Show when={account.note}>
                                      <p class="text-xs leading-snug text-dimmed">{account.note}</p>
                                    </Show>
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </DetailPanel.Section>
                      </Show>

                      <Show when={hasPersonal()}>
                        <DetailPanel.Section title="Personal" icon="ti ti-user" tone="neutral" collapsible defaultOpen>
                          <DescriptionList
                            layout="rows"
                            size="sm"
                            items={[
                              ...(hasFormalName() && c().firstName ? [{ term: "First name", description: c().firstName }] : []),
                              ...(hasFormalName() && c().lastName ? [{ term: "Last name", description: c().lastName }] : []),
                              ...(c().birthday ? [{ term: "Birthday", description: formatBirthday(c().birthday) ?? c().birthday }] : []),
                              ...(c().salutation ? [{ term: "Salutation", description: c().salutation }] : []),
                              ...(c().pronouns ? [{ term: "Pronouns", description: c().pronouns }] : []),
                              ...(c().preferredLanguage ? [{ term: "Language", description: c().preferredLanguage }] : []),
                            ]}
                          />
                        </DetailPanel.Section>
                      </Show>

                      <Show when={hasWork()}>
                        <DetailPanel.Section title="Work" icon="ti ti-briefcase" tone="accent" collapsible defaultOpen>
                          <DescriptionList
                            layout="rows"
                            size="sm"
                            items={[
                              ...(c().companyName ? [{ term: "Company", description: c().companyName }] : []),
                              ...(c().department ? [{ term: "Department", description: c().department }] : []),
                              ...(c().jobTitle ? [{ term: "Job title", description: c().jobTitle }] : []),
                              ...(c().vatId
                                ? [
                                    {
                                      term: "VAT ID",
                                      description: <span class="break-all font-mono">{c().vatId}</span>,
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </DetailPanel.Section>
                      </Show>
                    </DetailPanel.Group>
                  </Show>

                  <Show when={hasOrganization()}>
                    <DetailPanel.Group label="Organization context">
                      <DetailPanel.Section
                        title="Organization"
                        icon="ti ti-hierarchy"
                        tone="accent"
                        actions={
                          <>
                            <Show when={hasOrgTree()}>
                              <Button variant="ghost" size="sm" loading={actions.orgTreeLoading()} onClick={() => actions.openOrgTree(c())}>
                                <i class="ti ti-hierarchy" aria-hidden="true" /> Tree
                              </Button>
                            </Show>
                            <Show when={actions.canEdit()}>
                              <Button variant="ghost" size="sm" onClick={() => actions.openAddMemberDialog(c())}>
                                <i class="ti ti-plus" aria-hidden="true" /> Add member
                              </Button>
                            </Show>
                          </>
                        }
                      >
                        <div class="flex flex-col gap-1">
                          <Show when={c().parent}>
                            {(parent) => (
                              <DetailPanel.Action
                                type="button"
                                onClick={() =>
                                  setSelectedContactInUrl({
                                    contactId: parent().id,
                                    bookId: c().bookId,
                                    contact: null,
                                  })
                                }
                                leading={<i class="ti ti-arrow-up" aria-hidden="true" />}
                                title={resolveContactName(parent())}
                                description="Parent contact"
                                trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
                              />
                            )}
                          </Show>
                          <Show when={c().members.length > 0}>
                            <ul class="flex flex-col gap-1">
                              <For each={c().members}>
                                {(member) => (
                                  <li class="group flex items-center gap-1">
                                    <DetailPanel.Action
                                      type="button"
                                      class="min-w-0 flex-1"
                                      onClick={() =>
                                        setSelectedContactInUrl({
                                          contactId: member.id,
                                          bookId: c().bookId,
                                          contact: null,
                                        })
                                      }
                                      leading={
                                        <span
                                          class="contact-avatar flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium"
                                          aria-hidden="true"
                                        >
                                          {(resolveContactName(member as ContactRef) || "?").charAt(0).toUpperCase()}
                                        </span>
                                      }
                                      title={resolveContactName(member as ContactRef)}
                                      description={[member.companyName, member.jobTitle].filter(Boolean).join(" · ") || undefined}
                                      trailing={<i class="ti ti-chevron-right" aria-hidden="true" />}
                                    />
                                    <Show when={actions.canEdit()}>
                                      <Tooltip.Anchor content="Remove from members">
                                        <IconButton
                                          variant="ghost"
                                          size="xs"
                                          onClick={() => actions.unlinkMember(member, c())}
                                          class="shrink-0 text-dimmed opacity-100 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                                          label={`Remove ${resolveContactName(member as ContactRef)} from members`}
                                        >
                                          <i class="ti ti-unlink" aria-hidden="true" />
                                        </IconButton>
                                      </Tooltip.Anchor>
                                    </Show>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </Show>
                          <Show when={!c().parent && c().members.length === 0}>
                            <p class="px-2 py-1 text-sm text-dimmed">No hierarchy yet.</p>
                          </Show>
                        </div>
                      </DetailPanel.Section>
                    </DetailPanel.Group>
                  </Show>

                  <ContactNotesSection
                    bookId={c().bookId}
                    contactId={c().id}
                    currentUserId={props.currentUserId}
                    initialNotes={c().id === props.initialContactId ? props.initialNotes : []}
                    canWrite={actions.canEdit()}
                    isBookAdmin={props.adminBookIds.includes(c().bookId)}
                  />
                </DetailPanel.Body>
              </DetailPanel>
            }
          >
            {(tree) => (
              <ContactOrgTreeView
                tree={tree()}
                onSelect={(node) => actions.selectOrgTreeNode(node, c().bookId)}
                onBack={() => {
                  setDetailMode("details");
                  setOrgTree(null);
                }}
              />
            )}
          </Show>
        );
      }}
    </Show>
  );
}
