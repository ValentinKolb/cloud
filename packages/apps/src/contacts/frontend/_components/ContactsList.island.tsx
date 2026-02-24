import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Contact } from "../../service";
import { CONTACT_DETAIL_EVENT, getSelectedContactFromUrl, setSelectedContactInUrl, type ContactDetailPayload } from "./context";

type Props = {
  contacts: Contact[];
  bookNames: Record<string, string>;
  initialSelectedContactId: string | null;
  initialSelectedBookId: string | null;
  showBookName?: boolean;
};

const contactKey = (contactId: string | null, bookId: string | null) => (contactId && bookId ? `${bookId}:${contactId}` : null);

const primaryEmail = (contact: Contact) => contact.emails[0]?.email ?? null;
const primaryPhone = (contact: Contact) => contact.phones[0]?.phone ?? null;

const stopRowSelection = (event: MouseEvent) => {
  event.stopPropagation();
};

/**
 * Contacts table with hybrid detail-panel selection behavior.
 */
export default function ContactsList(props: Props) {
  const [selectedKey, setSelectedKey] = createSignal<string | null>(
    contactKey(props.initialSelectedContactId, props.initialSelectedBookId),
  );

  const selectContact = (contact: Contact) => {
    setSelectedKey(contactKey(contact.id, contact.bookId));
    setSelectedContactInUrl({
      contactId: contact.id,
      bookId: contact.bookId,
      contact,
    });
  };

  const handleRowKeyDown = (event: KeyboardEvent, contact: Contact) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectContact(contact);
  };

  onMount(() => {
    const handleDetailEvent = (event: Event) => {
      const payload = (event as CustomEvent<ContactDetailPayload>).detail;
      setSelectedKey(contactKey(payload.itemKey, payload.bookId));
    };

    const handlePopState = () => {
      const selected = getSelectedContactFromUrl();
      setSelectedKey(contactKey(selected.contactId, selected.bookId));
    };

    window.addEventListener(CONTACT_DETAIL_EVENT, handleDetailEvent);
    window.addEventListener("popstate", handlePopState);

    onCleanup(() => {
      window.removeEventListener(CONTACT_DETAIL_EVENT, handleDetailEvent);
      window.removeEventListener("popstate", handlePopState);
    });
  });

  return (
    <div class="paper overflow-hidden">
      <Show
        when={props.contacts.length > 0}
        fallback={
          <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
            <i class="ti ti-address-book text-sm" />
            No contacts found
          </p>
        }
      >
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                <th class="text-left px-4 py-3 font-medium text-dimmed">Name</th>
                <th class="hidden md:table-cell text-left px-4 py-3 font-medium text-dimmed">Email</th>
                <th class="hidden lg:table-cell text-left px-4 py-3 font-medium text-dimmed">Telephone</th>
                <Show when={props.showBookName}>
                  <th class="hidden xl:table-cell text-left px-4 py-3 font-medium text-dimmed">Book</th>
                </Show>
              </tr>
            </thead>
            <tbody>
              {props.contacts.map((contact) => {
                const key = contactKey(contact.id, contact.bookId);
                const active = () => selectedKey() === key;
                const email = primaryEmail(contact);
                const phone = primaryPhone(contact);

                return (
                  <tr
                    class={`border-b border-zinc-100 dark:border-zinc-800 last:border-0 cursor-pointer ${
                      active() ? "bg-blue-100 dark:bg-blue-900/35" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                    }`}
                    role="button"
                    tabIndex={0}
                    aria-current={active() ? "true" : undefined}
                    onClick={() => selectContact(contact)}
                    onKeyDown={(event) => handleRowKeyDown(event, contact)}
                  >
                    <td class="px-4 py-3 min-w-0">
                      <p class="font-medium truncate">{contact.displayName}</p>
                      <div class="mt-1 text-xs text-dimmed flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Show when={contact.companyName}>
                          <span class="inline-flex items-center gap-1 truncate max-w-full">
                            <i class="ti ti-building" />
                            <span class="truncate">{contact.companyName}</span>
                          </span>
                        </Show>
                        <Show when={email}>
                          <a
                            href={`mailto:${email}`}
                            class="inline-flex items-center gap-1 hover:text-blue-500 md:hidden"
                            onClick={stopRowSelection}
                          >
                            <i class="ti ti-mail" />
                            <span class="truncate max-w-48">{email}</span>
                          </a>
                        </Show>
                        <Show when={phone}>
                          <a
                            href={`tel:${phone}`}
                            class="inline-flex items-center gap-1 hover:text-blue-500 lg:hidden"
                            onClick={stopRowSelection}
                          >
                            <i class="ti ti-phone" />
                            <span>{phone}</span>
                          </a>
                        </Show>
                      </div>
                    </td>

                    <td class="hidden md:table-cell px-4 py-3 text-dimmed">
                      <Show when={email} fallback={<span class="text-zinc-400 dark:text-zinc-500">-</span>}>
                        <a href={`mailto:${email!}`} class="hover:text-blue-500 break-all" onClick={stopRowSelection}>
                          {email}
                        </a>
                      </Show>
                    </td>

                    <td class="hidden lg:table-cell px-4 py-3 text-dimmed whitespace-nowrap">
                      <Show when={phone} fallback={<span class="text-zinc-400 dark:text-zinc-500">-</span>}>
                        <a href={`tel:${phone!}`} class="hover:text-blue-500" onClick={stopRowSelection}>
                          {phone}
                        </a>
                      </Show>
                    </td>

                    <Show when={props.showBookName}>
                      <td class="hidden xl:table-cell px-4 py-3 text-dimmed whitespace-nowrap">
                        {props.bookNames[contact.bookId] ?? contact.bookId}
                      </td>
                    </Show>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}
