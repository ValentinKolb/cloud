import { Dropdown, Placeholder, Tooltip } from "@valentinkolb/cloud/ui";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Contact, ContactNote, ContactRef, ContactTree } from "../../service";
import { resolveContactInitials, resolveContactName, safeWebsiteHref } from "../../shared";
import { createContactDetailActions } from "./ContactDetailPanel.actions";
import ContactNotesSection from "./ContactNotesSection";
import ContactOrgTreeView from "./ContactOrgTreeView";
import ContactQuickEdit from "./ContactQuickEdit";
import ContactTagChip from "./ContactTagChip";
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
  const [, setContactId] = createSignal<string | null>(props.initialContactId);
  const [bookId, setBookId] = createSignal<string | null>(props.initialBookId);
  const [detailMode, setDetailMode] = createSignal<"details" | "tree">("details");
  const [quickEditing, setQuickEditing] = createSignal(false);
  const [orgTree, setOrgTree] = createSignal<ContactTree | null>(null);

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
    setContact(findContact(selected.contactId, selected.bookId));
    setContactId(selected.contactId);
    setBookId(selected.bookId);
    setDetailMode("details");
    setQuickEditing(false);
    setOrgTree(null);
  };

  onMount(() => {
    const handleSelect = (event: Event) => {
      const payload = (event as CustomEvent<ContactDetailPayload>).detail;
      setContact(payload.item ?? findContact(payload.itemKey, payload.bookId));
      setContactId(payload.itemKey);
      setBookId(payload.bookId);
      setDetailMode("details");
      setQuickEditing(false);
      setOrgTree(null);
    };

    const handlePopState = () => syncFromUrl();

    window.addEventListener(CONTACT_DETAIL_EVENT, handleSelect);
    window.addEventListener("popstate", handlePopState);

    onCleanup(() => {
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
        props.showEmpty === false ? null : (
          <Placeholder icon="ti ti-id" class="h-full min-h-0 justify-center">
            Select a contact to see details
          </Placeholder>
        )
      }
    >
      {(selectedContact) => {
        const c = selectedContact;
        const hasReach = () => c().emails.length > 0 || c().phones.length > 0 || c().websites.length > 0;
        const hasWork = () => !!(c().companyName || c().department || c().jobTitle || c().vatId);
        const hasFormalName = () => !!(c().label && (c().firstName || c().lastName));
        const hasPersonal = () => hasFormalName() || !!(c().birthday || c().salutation || c().pronouns || c().preferredLanguage);
        const hasOrgTree = () => c().parentContactId !== null || c().members.length > 0;
        return (
          <Show
            when={detailMode() === "tree" && orgTree()}
            fallback={
              <div class="flex h-full min-h-0 flex-col">
                <header class="detail-header" style="view-transition-name: contacts-detail-panel">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-semibold text-secondary">Contact details</span>
                    <div class="flex shrink-0 items-center gap-1">
                      <Show when={actions.canEdit() || actions.canMove()}>
                        <Dropdown
                          trigger={
                            <button type="button" class="icon-btn" aria-label="More contact actions">
                              <i class="ti ti-dots" />
                            </button>
                          }
                          elements={[
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
                          position="bottom-left"
                        />
                      </Show>
                      <Tooltip content="Close details">
                        <button
                          type="button"
                          class="icon-btn"
                          aria-label="Close contact detail panel"
                          onClick={() => clearSelectedContactInUrl()}
                        >
                          <i class="ti ti-x" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>

                  <div class="mt-4 flex flex-col items-center text-center">
                    <span
                      class="contact-avatar flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
                      aria-hidden="true"
                    >
                      {resolveContactInitials(c())}
                    </span>
                    <div class="mt-2 min-w-0 max-w-full">
                      <h2 class="truncate text-lg font-semibold leading-6 text-primary">{resolveContactName(c())}</h2>
                      <p class="mt-0.5 truncate text-xs text-dimmed">
                        {[c().jobTitle, c().companyName, props.bookNames[c().bookId]].filter(Boolean).join(" · ")}
                      </p>
                    </div>

                    <Show when={c().tags.length > 0}>
                      <div class="mt-2 flex max-w-full flex-wrap items-center justify-center gap-1.5">
                        <For each={c().tags}>{(tag) => <ContactTagChip name={tag.name} color={tag.color} size="sm" />}</For>
                      </div>
                    </Show>

                    <div class="mt-3 flex flex-wrap items-center justify-center gap-2">
                      <Show when={c().emails[0]}>
                        {(email) => (
                          <a href={`mailto:${email().email}`} class="btn-secondary btn-sm">
                            <i class="ti ti-mail" /> Email
                          </a>
                        )}
                      </Show>
                      <Show when={c().phones[0]}>
                        {(phone) => (
                          <a href={`tel:${phone().phone}`} class="btn-secondary btn-sm">
                            <i class="ti ti-phone" /> Call
                          </a>
                        )}
                      </Show>
                      <Show when={actions.canEdit()}>
                        <button type="button" class="btn-secondary btn-sm" onClick={() => requestContactNoteComposer(c().id)}>
                          <i class="ti ti-note" /> Note
                        </button>
                      </Show>
                    </div>
                  </div>
                </header>

                <div class="detail-stack">
                  <section class="detail-section">
                    <div class="mb-3 flex items-center justify-between gap-2">
                      <h3 class="detail-section-label mb-0">Key details</h3>
                      <Show when={actions.canEdit() && !quickEditing()}>
                        <button type="button" class="btn-simple btn-sm" onClick={() => setQuickEditing(true)}>
                          <i class="ti ti-pencil" /> Quick edit
                        </button>
                      </Show>
                    </div>
                    <Show
                      when={quickEditing()}
                      fallback={
                        <dl class="detail-facts">
                          <dt class="detail-fact-key">Name</dt>
                          <dd>{[c().firstName, c().lastName].filter(Boolean).join(" ") || resolveContactName(c())}</dd>
                          <dt class="detail-fact-key">Company</dt>
                          <dd>{c().companyName || <span class="text-dimmed">Not set</span>}</dd>
                          <dt class="detail-fact-key">Job title</dt>
                          <dd>{c().jobTitle || <span class="text-dimmed">Not set</span>}</dd>
                          <dt class="detail-fact-key">Book</dt>
                          <dd>{props.bookNames[c().bookId] ?? c().bookId}</dd>
                        </dl>
                      }
                    >
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
                  </section>

                  <Show when={hasReach()}>
                    <section class="detail-section">
                      <h3 class="detail-section-label">Reach</h3>
                      <For each={c().emails}>
                        {(email) => (
                          <a href={`mailto:${email.email}`} class="detail-row hover:text-primary">
                            <i class="ti ti-mail detail-row-icon text-dimmed" />
                            <Show when={email.label}>
                              <span class="detail-row-label">{email.label}</span>
                            </Show>
                            <span class="break-all">{email.email}</span>
                          </a>
                        )}
                      </For>
                      <For each={c().phones}>
                        {(phone) => (
                          <a href={`tel:${phone.phone}`} class="detail-row hover:text-primary">
                            <i class="ti ti-phone detail-row-icon text-dimmed" />
                            <Show when={phone.label}>
                              <span class="detail-row-label">{phone.label}</span>
                            </Show>
                            <span>{phone.phone}</span>
                          </a>
                        )}
                      </For>
                      <For each={c().websites}>
                        {(website) => (
                          <Show
                            when={safeWebsiteHref(website.url)}
                            fallback={
                              <div class="detail-row">
                                <i class="ti ti-world detail-row-icon text-dimmed" />
                                <Show when={website.label}>
                                  <span class="detail-row-label">{website.label}</span>
                                </Show>
                                <span class="break-all text-dimmed">{website.url}</span>
                              </div>
                            }
                          >
                            {(href) => (
                              <a href={href()} target="_blank" rel="noopener noreferrer" class="detail-row hover:text-primary">
                                <i class="ti ti-world detail-row-icon text-dimmed" />
                                <Show when={website.label}>
                                  <span class="detail-row-label">{website.label}</span>
                                </Show>
                                <span class="break-all">{website.url}</span>
                              </a>
                            )}
                          </Show>
                        )}
                      </For>
                    </section>
                  </Show>

                  <Show when={c().addresses.length > 0 || c().bankAccounts.length > 0 || hasPersonal() || hasWork()}>
                    <details class="detail-section group/details">
                      <summary class="focus-ui flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--ui-radius-control)] text-sm font-medium text-primary">
                        <span class="inline-flex items-center gap-2">
                          <i class="ti ti-list-details text-dimmed" /> More details
                        </span>
                        <i class="ti ti-chevron-down text-xs text-dimmed transition-transform group-open/details:rotate-180" />
                      </summary>
                      <div class="mt-3 divide-y divide-[var(--ui-divider)]">
                        <Show when={c().addresses.length > 0}>
                          <section class="py-3 first:pt-0 last:pb-0">
                            <h3 class="detail-section-label">Addresses</h3>
                            <For each={c().addresses}>
                              {(address) => (
                                <div class="mb-3 last:mb-0 flex gap-1.5 text-xs text-primary">
                                  <i class="ti ti-map-pin detail-row-icon mt-0.5 self-start text-dimmed" />
                                  <div class="min-w-0 flex-1">
                                    <Show when={address.label}>
                                      <p class="text-dimmed">{address.label}</p>
                                    </Show>
                                    <For each={formatAddress(address)}>{(line) => <p class="leading-snug">{line}</p>}</For>
                                  </div>
                                </div>
                              )}
                            </For>
                          </section>
                        </Show>

                        <Show when={c().bankAccounts.length > 0}>
                          <section class="py-3 first:pt-0 last:pb-0">
                            <h3 class="detail-section-label">Bank details</h3>
                            <For each={c().bankAccounts}>
                              {(account) => (
                                <div class="mb-3 last:mb-0 flex gap-1.5 text-xs text-primary">
                                  <i class="ti ti-building-bank detail-row-icon mt-0.5 self-start text-dimmed" />
                                  <div class="min-w-0 flex-1">
                                    <Show when={account.label}>
                                      <p class="text-dimmed">{account.label}</p>
                                    </Show>
                                    <p class="leading-snug">{account.accountHolderName}</p>
                                    <p class="break-all font-mono leading-snug">{account.iban}</p>
                                    <Show when={account.bic || account.bankName}>
                                      <p class="leading-snug text-dimmed">{[account.bankName, account.bic].filter(Boolean).join(" · ")}</p>
                                    </Show>
                                    <Show when={account.note}>
                                      <p class="leading-snug text-dimmed">{account.note}</p>
                                    </Show>
                                  </div>
                                </div>
                              )}
                            </For>
                          </section>
                        </Show>

                        <Show when={hasPersonal()}>
                          <section class="py-3 first:pt-0 last:pb-0">
                            <h3 class="detail-section-label">Personal</h3>
                            <dl class="detail-facts">
                              <Show when={hasFormalName() && c().firstName}>
                                <dt class="detail-fact-key">First name</dt>
                                <dd>{c().firstName}</dd>
                              </Show>
                              <Show when={hasFormalName() && c().lastName}>
                                <dt class="detail-fact-key">Last name</dt>
                                <dd>{c().lastName}</dd>
                              </Show>
                              <Show when={c().birthday}>
                                <dt class="detail-fact-key">Birthday</dt>
                                <dd>{formatBirthday(c().birthday) ?? c().birthday}</dd>
                              </Show>
                              <Show when={c().salutation}>
                                <dt class="detail-fact-key">Salutation</dt>
                                <dd>{c().salutation}</dd>
                              </Show>
                              <Show when={c().pronouns}>
                                <dt class="detail-fact-key">Pronouns</dt>
                                <dd>{c().pronouns}</dd>
                              </Show>
                              <Show when={c().preferredLanguage}>
                                <dt class="detail-fact-key">Language</dt>
                                <dd>{c().preferredLanguage}</dd>
                              </Show>
                            </dl>
                          </section>
                        </Show>

                        <Show when={hasWork()}>
                          <section class="py-3 first:pt-0 last:pb-0">
                            <h3 class="detail-section-label">Work</h3>
                            <dl class="detail-facts">
                              <Show when={c().companyName}>
                                <dt class="detail-fact-key">Company</dt>
                                <dd>{c().companyName}</dd>
                              </Show>
                              <Show when={c().department}>
                                <dt class="detail-fact-key">Department</dt>
                                <dd>{c().department}</dd>
                              </Show>
                              <Show when={c().jobTitle}>
                                <dt class="detail-fact-key">Job title</dt>
                                <dd>{c().jobTitle}</dd>
                              </Show>
                              <Show when={c().vatId}>
                                <dt class="detail-fact-key">VAT ID</dt>
                                <dd class="font-mono break-all">{c().vatId}</dd>
                              </Show>
                            </dl>
                          </section>
                        </Show>
                      </div>
                    </details>
                  </Show>

                  <Show when={c().parent || hasOrgTree() || c().members.length > 0 || actions.canEdit()}>
                    <section class="detail-section">
                      <h3 class="detail-section-label">Organization</h3>
                      <div class="flex flex-col gap-2">
                        <Show when={c().parent || hasOrgTree()}>
                          <div class="flex flex-col gap-2 rounded-md bg-[var(--ui-surface-subtle)] p-2 text-xs text-dimmed">
                            <div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                              <span>{props.bookNames[c().bookId] ?? c().bookId}</span>
                              <Show when={c().parent}>
                                {(parent) => (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>part of</span>
                                    <button
                                      type="button"
                                      class="min-w-0 truncate text-left font-medium text-primary transition-colors hover:underline"
                                      onClick={() =>
                                        setSelectedContactInUrl({
                                          contactId: parent().id,
                                          bookId: c().bookId,
                                          contact: null,
                                        })
                                      }
                                      title={`Open ${resolveContactName(parent())}`}
                                    >
                                      {resolveContactName(parent())}
                                    </button>
                                  </>
                                )}
                              </Show>
                              <Show when={hasOrgTree()}>
                                <button
                                  type="button"
                                  class="btn-simple btn-sm ml-auto shrink-0"
                                  aria-label="Show org tree"
                                  title="Show org tree"
                                  disabled={actions.orgTreeLoading()}
                                  onClick={() => actions.openOrgTree(c())}
                                >
                                  {actions.orgTreeLoading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-hierarchy" />}
                                  Tree
                                </button>
                              </Show>
                            </div>
                          </div>
                        </Show>
                        <Show when={c().members.length > 0}>
                          <ul class="flex flex-col gap-1">
                            <For each={c().members}>
                              {(member) => (
                                <li class="group flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedContactInUrl({
                                        contactId: member.id,
                                        bookId: c().bookId,
                                        contact: null,
                                      })
                                    }
                                    class="flex flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--ui-hover)]"
                                  >
                                    <div class="contact-avatar flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                                      {(resolveContactName(member as ContactRef) || "?").charAt(0).toUpperCase()}
                                    </div>
                                    <div class="min-w-0 flex-1">
                                      <div class="truncate text-sm text-primary">{resolveContactName(member as ContactRef)}</div>
                                      <Show when={member.companyName || member.jobTitle}>
                                        <div class="truncate text-xs text-dimmed">
                                          {[member.companyName, member.jobTitle].filter(Boolean).join(" · ")}
                                        </div>
                                      </Show>
                                    </div>
                                  </button>
                                  <Show when={actions.canEdit()}>
                                    <button
                                      type="button"
                                      onClick={() => actions.unlinkMember(member, c())}
                                      class="focus-ui flex h-7 w-7 shrink-0 items-center justify-center rounded text-dimmed opacity-100 transition-all hover:bg-red-500/[0.08] hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                                      aria-label={`Remove ${resolveContactName(member as ContactRef)} from members`}
                                      title="Remove from members"
                                    >
                                      <i class="ti ti-unlink text-sm" />
                                    </button>
                                  </Show>
                                </li>
                              )}
                            </For>
                          </ul>
                        </Show>
                        <Show when={actions.canEdit()}>
                          <button
                            type="button"
                            class="btn-simple btn-sm w-fit text-xs text-dimmed hover:text-primary"
                            onClick={() => actions.openAddMemberDialog(c())}
                          >
                            <i class="ti ti-plus" /> Add member
                          </button>
                        </Show>
                      </div>
                    </section>
                  </Show>

                  <section class="detail-section">
                    <ContactNotesSection
                      bookId={c().bookId}
                      contactId={c().id}
                      currentUserId={props.currentUserId}
                      initialNotes={c().id === props.initialContactId ? props.initialNotes : []}
                      canWrite={actions.canEdit()}
                      isBookAdmin={props.adminBookIds.includes(c().bookId)}
                    />
                  </section>
                </div>
              </div>
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
