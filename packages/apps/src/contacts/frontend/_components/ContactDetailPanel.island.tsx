import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Contact } from "../../service";
import {
  CONTACT_DETAIL_EVENT,
  buildContactEditUrl,
  clearSelectedContactInUrl,
  getSelectedContactFromUrl,
  type ContactDetailPayload,
} from "./context";
type Props = {
  initialContact: Contact | null;
  initialContactId: string | null;
  initialBookId: string | null;
  contacts: Contact[];
  bookNames: Record<string, string>;
  editableBookIds: string[];
};
const formatBirthday = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-DE");
};
const formatAddress = (address: Contact["addresses"][number]) => {
  const lines = [
    address.recipientName,
    address.companyName,
    address.line1,
    address.line2,
    `${address.postalCode} ${address.city}`,
    address.stateRegion,
    address.countryCode,
  ].filter(Boolean) as string[];
  return lines;
}; /** * Detail panel for selected contacts. * Updates instantly on client-side row selection and browser navigation. */
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
    const found = findContact(selected.contactId, selected.bookId);
    setContact(found);
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
    return props.editableBookIds.includes(selectedBookId);
  };
  return (
    <Show
      when={contact()}
      fallback={
        <div class="flex h-full min-h-0 flex-col justify-center items-center gap-2 px-3 py-6 text-xs text-dimmed">
          <p class="flex items-center justify-center gap-1.5 text-center">
            <i class="ti ti-id" /> Select a contact to see details
          </p>
        </div>
      }
    >
      {(selectedContact) => (
        <div class="flex h-full min-h-0 flex-col">
          <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
            <section class="space-y-2" style="view-transition-name: contacts-detail-panel">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <h2 class="text-base font-semibold text-primary truncate">{selectedContact().displayName}</h2>
                  <p class="text-xs text-dimmed truncate">{props.bookNames[selectedContact().bookId] ?? selectedContact().bookId}</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <Show when={canEdit()}>
                    <a
                      href={buildContactEditUrl(selectedContact().bookId, selectedContact().id)}
                      class="btn-secondary btn-sm"
                      aria-label="Edit contact"
                    >
                      <i class="ti ti-pencil" /> Edit
                    </a>
                  </Show>
                  <button
                    type="button"
                    class="btn-secondary btn-sm"
                    aria-label="Close contact detail panel"
                    onClick={() => clearSelectedContactInUrl()}
                  >
                    <i class="ti ti-x" /> Close
                  </button>
                </div>
              </div>
            </section>
            <Show
              when={selectedContact().companyName || selectedContact().department || selectedContact().jobTitle || selectedContact().vatId}
            >
              <section class="space-y-1.5 text-xs">
                <h3 class="section-label mb-0">Business</h3>
                <div class="paper p-3 space-y-1.5">
                  <Show when={selectedContact().companyName}>
                    <p>
                      <strong>Company:</strong> {selectedContact().companyName}
                    </p>
                  </Show>
                  <Show when={selectedContact().department}>
                    <p>
                      <strong>Department:</strong> {selectedContact().department}
                    </p>
                  </Show>
                  <Show when={selectedContact().jobTitle}>
                    <p>
                      <strong>Job Title:</strong> {selectedContact().jobTitle}
                    </p>
                  </Show>
                  <Show when={selectedContact().vatId}>
                    <p>
                      <strong>VAT ID:</strong> {selectedContact().vatId}
                    </p>
                  </Show>
                </div>
              </section>
            </Show>
            <Show
              when={
                selectedContact().emails.length > 0 ||
                selectedContact().phones.length > 0 ||
                selectedContact().website ||
                selectedContact().birthday
              }
            >
              <section class="space-y-2 text-xs">
                <h3 class="section-label mb-0">Contact</h3>
                <div class="paper p-3 space-y-3">
                  <Show when={selectedContact().emails.length > 0}>
                    <div class="space-y-1.5">
                      <p class="text-dimmed">Emails</p>
                      {selectedContact().emails.map((email) => (
                        <a href={`mailto:${email.email}`} class="block hover:text-blue-500 break-all">
                          <i class="ti ti-mail mr-1" /> {email.label ? `${email.label}: ` : ""} {email.email}
                        </a>
                      ))}
                    </div>
                  </Show>
                  <Show when={selectedContact().phones.length > 0}>
                    <div class="space-y-1.5">
                      <p class="text-dimmed">Phones</p>
                      {selectedContact().phones.map((phone) => (
                        <a href={`tel:${phone.phone}`} class="block hover:text-blue-500">
                          <i class="ti ti-phone mr-1" /> {phone.label ? `${phone.label}: ` : ""} {phone.phone}
                        </a>
                      ))}
                    </div>
                  </Show>
                  <Show when={selectedContact().website || selectedContact().birthday}>
                    <div class="space-y-1.5">
                      <p class="text-dimmed">Additional</p>
                      <Show when={selectedContact().website}>
                        <a
                          href={selectedContact().website ?? ""}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="block hover:text-blue-500 break-all"
                        >
                          <i class="ti ti-world mr-1" /> {selectedContact().website}
                        </a>
                      </Show>
                      <Show when={selectedContact().birthday}>
                        <p>
                          <strong>Birthday:</strong> {formatBirthday(selectedContact().birthday)}
                        </p>
                      </Show>
                    </div>
                  </Show>
                </div>
              </section>
            </Show>
            <Show when={selectedContact().addresses.length > 0}>
              <section class="space-y-2 text-xs">
                <h3 class="section-label mb-0">Addresses</h3>
                <div class="paper p-3 space-y-3">
                  {selectedContact().addresses.map((address) => (
                    <div class="space-y-0.5">
                      <p class="text-dimmed">{address.label ? `${address.label}` : "Address"}</p>
                      {formatAddress(address).map((line) => (
                        <p>{line}</p>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            </Show>
            <Show when={selectedContact().note}>
              <section class="space-y-2 text-xs">
                <h3 class="section-label mb-0">Note</h3>
                <div class="paper p-3">
                  <p class="whitespace-pre-wrap text-secondary">{selectedContact().note}</p>
                </div>
              </section>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
