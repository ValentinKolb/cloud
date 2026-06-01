import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Contact, ContactNote, ContactRef, ContactTree } from "../../service";
import { resolveContactName } from "../../shared";
import ContactNotesSection from "./ContactNotesSection.island";
import { createContactDetailActions } from "./ContactDetailPanel.actions";
import ContactOrgTreeView from "./ContactOrgTreeView";
import {
  CONTACT_DETAIL_EVENT,
  type ContactDetailPayload,
  clearSelectedContactInUrl,
  getSelectedContactFromUrl,
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
    setOrgTree(null);
  };

  onMount(() => {
    const handleSelect = (event: Event) => {
      const payload = (event as CustomEvent<ContactDetailPayload>).detail;
      setContact(payload.item ?? findContact(payload.itemKey, payload.bookId));
      setContactId(payload.itemKey);
      setBookId(payload.bookId);
      setDetailMode("details");
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
          <div class="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-3 py-6 text-xs text-dimmed">
            <p class="flex items-center justify-center gap-1.5 text-center">
              <i class="ti ti-id" /> Select a contact to see details
            </p>
          </div>
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
                <div class="flex-1 min-h-0 overflow-y-auto">
                  <section class="detail-section" style="view-transition-name: contacts-detail-panel">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0 flex-1">
                        <h2 class="truncate text-lg font-semibold leading-tight text-primary">{resolveContactName(c())}</h2>
                        <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span class="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            <i class="ti ti-address-book mr-1 text-[10px]" />
                            {props.bookNames[c().bookId] ?? c().bookId}
                          </span>
                          <Show when={c().companyName}>
                            <span class="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                              <i class="ti ti-building text-[10px]" />
                              {c().companyName}
                            </span>
                          </Show>
                          <Show when={c().parent}>
                            {(parent) => (
                              <button
                                type="button"
                                class="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 transition-colors hover:bg-zinc-200 hover:text-primary dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                                onClick={() => setSelectedContactInUrl({ contactId: parent().id, bookId: c().bookId, contact: null })}
                                title={`Open ${resolveContactName(parent())}`}
                              >
                                <i class="ti ti-corner-down-right text-[10px]" />
                                part of {resolveContactName(parent())}
                              </button>
                            )}
                          </Show>
                          <For each={c().tags}>
                            {(tag) => (
                              <span
                                class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium"
                                style={`background-color: ${tag.color}1f; color: ${tag.color}`}
                              >
                                <span class="h-1.5 w-1.5 rounded-full" style={`background-color: ${tag.color}`} />
                                {tag.name}
                              </span>
                            )}
                          </For>
                        </div>
                      </div>
                      <div class="flex shrink-0 items-center gap-1">
                        <Show when={hasOrgTree()}>
                          <button
                            type="button"
                            class="btn-simple btn-sm text-dimmed hover:text-primary"
                            aria-label="Show org tree"
                            title="Show org tree"
                            disabled={actions.orgTreeLoading()}
                            onClick={() => actions.openOrgTree(c())}
                          >
                            {actions.orgTreeLoading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-hierarchy" />}
                          </button>
                        </Show>
                        <Show when={actions.canEdit()}>
                          <button
                            type="button"
                            class="btn-simple btn-sm text-dimmed hover:text-primary"
                            aria-label="Edit contact"
                            onClick={() => actions.openEditDialog(c())}
                          >
                            <i class="ti ti-pencil" />
                          </button>
                        </Show>
                        <Show when={actions.canMove()}>
                          <button
                            type="button"
                            class="btn-simple btn-sm text-dimmed hover:text-primary"
                            aria-label="Move contact to another book"
                            title="Move to another book"
                            onClick={() => actions.moveToBook(c())}
                          >
                            <i class="ti ti-folder-symlink" />
                          </button>
                        </Show>
                        <button
                          type="button"
                          class="btn-simple btn-sm text-dimmed hover:text-primary"
                          aria-label="Close contact detail panel"
                          onClick={() => clearSelectedContactInUrl()}
                        >
                          <i class="ti ti-x" />
                        </button>
                      </div>
                    </div>
                  </section>

                  <Show when={hasReach()}>
                    <section class="detail-section">
                      <h3 class="detail-section-label">Reach</h3>
                      <For each={c().emails}>
                        {(email) => (
                          <a href={`mailto:${email.email}`} class="detail-row hover:text-blue-500">
                            <i class="ti ti-mail detail-row-icon text-blue-500 dark:text-blue-400" />
                            <Show when={email.label}>
                              <span class="detail-row-label">{email.label}</span>
                            </Show>
                            <span class="break-all">{email.email}</span>
                          </a>
                        )}
                      </For>
                      <For each={c().phones}>
                        {(phone) => (
                          <a href={`tel:${phone.phone}`} class="detail-row hover:text-green-600">
                            <i class="ti ti-phone detail-row-icon text-green-600 dark:text-green-400" />
                            <Show when={phone.label}>
                              <span class="detail-row-label">{phone.label}</span>
                            </Show>
                            <span>{phone.phone}</span>
                          </a>
                        )}
                      </For>
                      <For each={c().websites}>
                        {(website) => (
                          <a href={website.url} target="_blank" rel="noreferrer" class="detail-row hover:text-purple-600">
                            <i class="ti ti-world detail-row-icon text-purple-600 dark:text-purple-400" />
                            <Show when={website.label}>
                              <span class="detail-row-label">{website.label}</span>
                            </Show>
                            <span class="break-all">{website.url}</span>
                          </a>
                        )}
                      </For>
                    </section>
                  </Show>

                  <Show when={c().addresses.length > 0}>
                    <section class="detail-section">
                      <h3 class="detail-section-label">Addresses</h3>
                      <For each={c().addresses}>
                        {(address) => (
                          <div class="mb-3 last:mb-0 flex gap-1.5 text-xs text-primary">
                            <i class="ti ti-map-pin detail-row-icon mt-0.5 self-start text-amber-600 dark:text-amber-400" />
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
                    <section class="detail-section">
                      <h3 class="detail-section-label">Bank Details</h3>
                      <For each={c().bankAccounts}>
                        {(account) => (
                          <div class="mb-3 last:mb-0 flex gap-1.5 text-xs text-primary">
                            <i class="ti ti-building-bank detail-row-icon mt-0.5 self-start text-emerald-600 dark:text-emerald-400" />
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
                    <section class="detail-section">
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
                    <section class="detail-section">
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

                  <Show when={c().members.length > 0 || actions.canEdit()}>
                    <section class="detail-section">
                      <h3 class="detail-section-label">Members</h3>
                      <div class="flex flex-col gap-2">
                        <Show when={c().members.length > 0}>
                          <ul class="flex flex-col gap-1">
                            <For each={c().members}>
                              {(member) => (
                                <li class="group flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedContactInUrl({ contactId: member.id, bookId: c().bookId, contact: null })}
                                    class="flex flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                  >
                                    <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium dark:bg-zinc-700">
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
                                      class="shrink-0 p-1 text-dimmed opacity-0 transition-all hover:text-red-500 group-hover:opacity-100"
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
