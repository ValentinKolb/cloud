import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { resolveContactName } from "../../shared";
import type { Contact } from "../../service";
import { CONTACT_DETAIL_EVENT, getSelectedContactFromUrl, setSelectedContactInUrl, type ContactDetailPayload } from "./context";

type Props = {
  contacts: Contact[];
  initialSelectedContactId: string | null;
  initialSelectedBookId: string | null;
};

const contactKey = (contactId: string | null, bookId: string | null) => (contactId && bookId ? `${bookId}:${contactId}` : null);
const primaryEmail = (contact: Contact) => contact.emails[0]?.email ?? null;
const primaryPhone = (contact: Contact) => contact.phones[0]?.phone ?? null;

const stopRowSelection = (event: MouseEvent) => {
  event.stopPropagation();
};

export default function ContactsList(props: Props) {
  const [selectedKey, setSelectedKey] = createSignal<string | null>(contactKey(props.initialSelectedContactId, props.initialSelectedBookId));

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
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b border-zinc-100 dark:border-zinc-800">
                <th class="px-3 py-1.5 text-left font-medium text-dimmed">Name</th>
                <th class="hidden md:table-cell px-3 py-1.5 text-left font-medium text-dimmed">Company</th>
                <th class="hidden lg:table-cell px-3 py-1.5 text-left font-medium text-dimmed">Phone</th>
                <th class="hidden xl:table-cell px-3 py-1.5 text-left font-medium text-dimmed">Email</th>
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
                    class={`group cursor-pointer border-b border-zinc-50 dark:border-zinc-800/50 last:border-0 ${
                      active() ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                    }`}
                    role="button"
                    tabIndex={0}
                    aria-current={active() ? "true" : undefined}
                    onClick={() => selectContact(contact)}
                    onKeyDown={(event) => handleRowKeyDown(event, contact)}
                  >
                    <td class="px-3 py-1.5 font-medium text-primary">
                      <div class="flex flex-col gap-0.5">
                        <span class="truncate group-hover:underline">{resolveContactName(contact)}</span>
                        <div class="flex flex-wrap items-center gap-1">
                          <Show when={contact.parent}>
                            {(parent) => (
                              <span
                                class="inline-flex w-fit items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                title={`Belongs to ${resolveContactName(parent())}`}
                              >
                                <i class="ti ti-corner-down-right text-[9px]" />
                                {resolveContactName(parent())}
                              </span>
                            )}
                          </Show>
                          <For each={contact.tags}>
                            {(tag) => (
                              <span
                                class="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-normal"
                                style={`background-color: ${tag.color}1f; color: ${tag.color}`}
                              >
                                <span class="h-1.5 w-1.5 rounded-full" style={`background-color: ${tag.color}`} />
                                {tag.name}
                              </span>
                            )}
                          </For>
                        </div>
                      </div>
                    </td>
                    <td class="hidden md:table-cell px-3 py-1.5 text-dimmed">
                      <Show when={contact.companyName} fallback={<span class="text-zinc-400 dark:text-zinc-500">-</span>}>
                        <span class="truncate">{contact.companyName}</span>
                      </Show>
                    </td>
                    <td class="hidden lg:table-cell px-3 py-1.5 text-dimmed whitespace-nowrap">
                      <Show when={phone} fallback={<span class="text-zinc-400 dark:text-zinc-500">-</span>}>
                        <a href={`tel:${phone!}`} class="hover:text-blue-500" onClick={stopRowSelection}>
                          {phone}
                        </a>
                      </Show>
                    </td>
                    <td class="hidden xl:table-cell px-3 py-1.5 text-dimmed">
                      <Show when={email} fallback={<span class="text-zinc-400 dark:text-zinc-500">-</span>}>
                        <a href={`mailto:${email!}`} class="truncate hover:text-blue-500" onClick={stopRowSelection}>
                          {email}
                        </a>
                      </Show>
                    </td>
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
