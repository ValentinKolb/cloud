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

const formatAddress = (address: Contact["addresses"][number]) =>
  [
    address.recipientName,
    address.companyName,
    address.line1,
    address.line2,
    `${address.postalCode} ${address.city}`,
    address.stateRegion,
    address.countryCode,
  ].filter(Boolean) as string[];

type FactItem = {
  label: string;
  value: string;
  mono?: boolean;
};

function FactsCard(props: { items: FactItem[] }) {
  const rows = () => {
    const next: FactItem[][] = [];
    for (let index = 0; index < props.items.length; index += 2) {
      next.push(props.items.slice(index, index + 2));
    }
    return next;
  };

  return (
    <div class="paper overflow-hidden">
      <div class="divide-y divide-zinc-200 dark:divide-zinc-800">
        <For each={rows()}>
          {(row) => (
            <dl class={`grid ${row.length > 1 ? "sm:grid-cols-2 sm:divide-x sm:divide-zinc-200 dark:sm:divide-zinc-800" : ""}`}>
              <For each={row}>
                {(fact) => (
                  <div class="px-3 py-2">
                    <dt class="text-[10px] uppercase tracking-[0.22em] text-dimmed">{fact.label}</dt>
                    <dd class={`mt-1 text-xs text-primary ${fact.mono ? "font-mono break-all" : ""}`}>{fact.value}</dd>
                  </div>
                )}
              </For>
            </dl>
          )}
        </For>
      </div>
    </div>
  );
}

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
      {(selectedContact) => (
        <div class="flex h-full min-h-0 flex-col">
          <div class="flex-1 min-h-0 overflow-y-auto">
            <div class="flex flex-col gap-5">
              <section class="flex shrink-0 flex-col gap-2" style="view-transition-name: contacts-detail-panel">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <h2 class="truncate text-lg font-semibold leading-tight text-primary">{resolveContactName(selectedContact())}</h2>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span class="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {props.bookNames[selectedContact().bookId] ?? selectedContact().bookId}
                      </span>
                      <Show when={selectedContact().companyName}>
                        <span class="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                          <i class="ti ti-building text-[10px]" />
                          {selectedContact().companyName}
                        </span>
                      </Show>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <Show when={canEdit()}>
                      <button
                        type="button"
                        class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
                        aria-label="Edit contact"
                        onClick={() => openEditDialog(selectedContact())}
                      >
                        <i class="ti ti-pencil" /> Edit
                      </button>
                    </Show>
                    <Show when={canMove()}>
                      <button
                        type="button"
                        class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
                        aria-label="Move contact to another book"
                        onClick={() => moveToBook(selectedContact())}
                      >
                        <i class="ti ti-arrows-transfer-up-down" /> Move
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
                      aria-label="Close contact detail panel"
                      onClick={() => clearSelectedContactInUrl()}
                    >
                      <i class="ti ti-x" /> Close
                    </button>
                  </div>
                </div>
              </section>

              <FactsCard
                items={[
                  ...(selectedContact().firstName ? [{ label: "First Name", value: selectedContact().firstName ?? "" }] : []),
                  ...(selectedContact().lastName ? [{ label: "Last Name", value: selectedContact().lastName ?? "" }] : []),
                  ...(selectedContact().department ? [{ label: "Department", value: selectedContact().department ?? "" }] : []),
                  ...(selectedContact().jobTitle ? [{ label: "Job Title", value: selectedContact().jobTitle ?? "" }] : []),
                  ...(selectedContact().vatId ? [{ label: "VAT ID", value: selectedContact().vatId ?? "" }] : []),
                  ...(selectedContact().birthday
                    ? [{ label: "Birthday", value: formatBirthday(selectedContact().birthday) ?? selectedContact().birthday ?? "" }]
                    : []),
                  ...(selectedContact().website ? [{ label: "Website", value: selectedContact().website ?? "", mono: true }] : []),
                ]}
              />

              <Show when={selectedContact().emails.length > 0 || selectedContact().phones.length > 0}>
                <section class="flex shrink-0 flex-col gap-2 text-xs">
                  <h3 class="section-label mb-0">Contact</h3>
                  <div class="paper overflow-hidden">
                    <Show when={selectedContact().emails.length > 0}>
                      <div class="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                        <p class="mb-1.5 text-[10px] uppercase tracking-[0.22em] text-dimmed">Emails</p>
                        {selectedContact().emails.map((email) => (
                          <a href={`mailto:${email.email}`} class="flex items-center gap-2 break-all py-0.5 hover:text-blue-500">
                            <i class="ti ti-mail shrink-0" /> <span>{email.label ? `${email.label}: ` : ""}</span> {email.email}
                          </a>
                        ))}
                      </div>
                    </Show>
                    <Show when={selectedContact().phones.length > 0}>
                      <div class="px-3 py-2">
                        <p class="mb-1.5 text-[10px] uppercase tracking-[0.22em] text-dimmed">Phones</p>
                        {selectedContact().phones.map((phone) => (
                          <a href={`tel:${phone.phone}`} class="flex items-center gap-2 py-0.5 hover:text-blue-500">
                            <i class="ti ti-phone shrink-0" /> <span>{phone.label ? `${phone.label}: ` : ""}</span> {phone.phone}
                          </a>
                        ))}
                      </div>
                    </Show>
                  </div>
                </section>
              </Show>

              <Show when={selectedContact().addresses.length > 0}>
                <section class="flex shrink-0 flex-col gap-2 text-xs">
                  <h3 class="section-label mb-0">Addresses</h3>
                  <div class="paper overflow-hidden">
                    {selectedContact().addresses.map((address) => (
                      <div class="border-b border-zinc-200 px-3 py-2 last:border-b-0 dark:border-zinc-800">
                        <p class="mb-1 text-[10px] uppercase tracking-[0.22em] text-dimmed">{address.label ? `${address.label}` : "Address"}</p>
                        {formatAddress(address).map((line) => (
                          <p class="py-0.5">{line}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                </section>
              </Show>

              <Show when={selectedContact().note}>
                <section class="flex shrink-0 flex-col gap-2 text-xs">
                  <h3 class="section-label mb-0">Note</h3>
                  <div class="paper px-3 py-2">
                    <p class="whitespace-pre-wrap text-secondary">{selectedContact().note}</p>
                  </div>
                </section>
              </Show>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
