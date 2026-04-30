import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import { resolveContactName } from "../../shared";
import type { Contact } from "../../service";
import { navigateTo } from "@valentinkolb/cloud/ui";
import { CONTACT_DETAIL_EVENT, clearSelectedContactInUrl, getSelectedContactFromUrl, setSelectedContactInUrl, type ContactDetailPayload } from "./context";
import ContactUpsertForm from "./ContactUpsertForm.island";

type Props = {
  initialContact: Contact | null;
  initialContactId: string | null;
  initialBookId: string | null;
  contacts: Contact[];
  bookNames: Record<string, string>;
  writableBooks: Array<{ id: string; name: string }>;
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
  return [
    address.recipientName,
    address.companyName,
    address.line1,
    address.line2,
    cityLine,
    regionLine,
  ].filter(Boolean) as string[];
};

export default function ContactDetailPanel(props: Props) {
  const [contact, setContact] = createSignal<Contact | null>(props.initialContact);
  const [contactId, setContactId] = createSignal<string | null>(props.initialContactId);
  const [bookId, setBookId] = createSignal<string | null>(props.initialBookId);

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
  };

  onMount(() => {
    const handleSelect = (event: Event) => {
      const payload = (event as CustomEvent<ContactDetailPayload>).detail;
      setContact(payload.item ?? findContact(payload.itemKey, payload.bookId));
      setContactId(payload.itemKey);
      setBookId(payload.bookId);
    };

    const handlePopState = () => syncFromUrl();

    window.addEventListener(CONTACT_DETAIL_EVENT, handleSelect);
    window.addEventListener("popstate", handlePopState);

    onCleanup(() => {
      window.removeEventListener(CONTACT_DETAIL_EVENT, handleSelect);
      window.removeEventListener("popstate", handlePopState);
    });
  });

  const canEdit = () => {
    const selectedBookId = bookId();
    if (!selectedBookId || selectedBookId === "system") return false;
    return props.writableBooks.some((entry) => entry.id === selectedBookId);
  };

  const canMove = () => {
    const selectedBookId = bookId();
    if (!selectedBookId || selectedBookId === "system") return false;
    return props.writableBooks.some((entry) => entry.id !== selectedBookId);
  };

  const moveMutation = mutations.create<Contact, { targetBookId: string; contact: Contact }>({
    mutation: async ({ targetBookId, contact }) => {
      const response = await apiClient.books[":bookId"].contacts[":contactId"].move.$post({
        param: {
          bookId: contact.bookId,
          contactId: contact.id,
        },
        json: { targetBookId },
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? "Failed to move contact");
      }

      return (await response.json()) as Contact;
    },
    onSuccess: (moved) => {
      navigateTo(`/app/contacts/${moved.bookId}?contact=${moved.id}&contactBook=${moved.bookId}`);
    },
    onError: (error) => {
      void prompts.error(error.message);
    },
  });

  const openEditDialog = async (selectedContact: Contact) => {
    const updated = await prompts.dialog<Contact | undefined>(
      (close) => (
        <ContactUpsertForm
          mode="edit"
          bookId={selectedContact.bookId}
          initialContact={selectedContact}
          onCancel={() => close(undefined)}
          onSaved={(contact) => close(contact)}
        />
      ),
      {
        title: `Edit ${resolveContactName(selectedContact)}`,
        icon: "ti ti-pencil",
        size: "large",
      },
    );

    if (!updated) return;
    setSelectedContactInUrl({
      contactId: updated.id,
      bookId: updated.bookId,
      contact: updated,
    });
  };

  const moveToBook = async (selectedContact: Contact) => {
    const targetOptions = props.writableBooks.filter((entry) => entry.id !== selectedContact.bookId);
    if (targetOptions.length === 0) {
      await prompts.alert("There is no other writable contact book available.", {
        title: "No target book",
        icon: "ti ti-address-book-off",
      });
      return;
    }

    const result = await prompts.form({
      title: "Move Contact",
      icon: "ti ti-arrows-transfer-up-down",
      confirmText: "Move",
      fields: {
        targetBookId: {
          type: "select",
          label: "Move this contact to which book?",
          required: true,
          options: targetOptions.map((entry) => ({
            id: entry.id,
            label: entry.name,
            icon: "ti ti-address-book",
          })),
        },
      },
    });

    if (!result) return;
    moveMutation.mutate({ targetBookId: result.targetBookId, contact: selectedContact });
  };

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
        const hasReach = () => c().emails.length > 0 || c().phones.length > 0 || !!c().website;
        const hasWork = () => !!(c().companyName || c().department || c().jobTitle || c().vatId);
        const hasFormalName = () => !!(c().label && (c().firstName || c().lastName));
        const hasPersonal = () => hasFormalName() || !!c().birthday;

        return (
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
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <Show when={canEdit()}>
                      <button
                        type="button"
                        class="btn-simple btn-sm text-dimmed hover:text-primary"
                        aria-label="Edit contact"
                        onClick={() => openEditDialog(c())}
                      >
                        <i class="ti ti-pencil" />
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
                <Show when={canMove()}>
                  <div class="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class="btn-secondary btn-sm"
                      aria-label="Move contact to another book"
                      onClick={() => moveToBook(c())}
                    >
                      <i class="ti ti-arrows-transfer-up-down" /> Move
                    </button>
                  </div>
                </Show>
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
                  <Show when={c().website}>
                    <a href={c().website!} target="_blank" rel="noreferrer" class="detail-row hover:text-purple-600">
                      <i class="ti ti-world detail-row-icon text-purple-600 dark:text-purple-400" />
                      <span class="break-all">{c().website}</span>
                    </a>
                  </Show>
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
                  </dl>
                </section>
              </Show>

              <Show when={c().note}>
                <section class="detail-section">
                  <h3 class="detail-section-label">Note</h3>
                  <p class="whitespace-pre-wrap text-xs text-secondary">{c().note}</p>
                </section>
              </Show>

            </div>
          </div>
        );
      }}
    </Show>
  );
}
