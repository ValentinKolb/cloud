import { DataTable, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Contact } from "../../service";
import { resolveContactName } from "../../shared";
import { CONTACT_DETAIL_EVENT, type ContactDetailPayload, getSelectedContactFromUrl, setSelectedContactInUrl } from "./context";

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
  const [selectedKey, setSelectedKey] = createSignal<string | null>(
    contactKey(props.initialSelectedContactId, props.initialSelectedBookId),
  );
  const columns: DataTableColumn<Contact>[] = [
    { id: "name", header: "Name", value: resolveContactName },
    { id: "company", header: "Company", value: (contact) => contact.companyName, class: "hidden md:table-cell" },
    { id: "phone", header: "Phone", value: primaryPhone, class: "hidden lg:table-cell", cellClass: "whitespace-nowrap" },
    { id: "email", header: "Email", value: primaryEmail, class: "hidden xl:table-cell" },
  ];

  const selectContact = (contact: Contact) => {
    setSelectedKey(contactKey(contact.id, contact.bookId));
    setSelectedContactInUrl({
      contactId: contact.id,
      bookId: contact.bookId,
      contact,
    });
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
        <DataTable
          rows={props.contacts}
          columns={columns}
          getRowId={(contact) => contactKey(contact.id, contact.bookId) ?? contact.id}
          selectedRowId={selectedKey()}
          onRowClick={selectContact}
          density="compact"
          class="overflow-x-auto"
          renderCell={({ row: contact, col }) => {
            if (col.id === "name") {
              return (
                <div class="flex flex-col gap-0.5">
                  <span class="truncate font-medium text-primary hover:underline">{resolveContactName(contact)}</span>
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
              );
            }
            if (col.id === "company") {
              return (
                <Show when={contact.companyName} fallback={<span class="text-zinc-400 dark:text-zinc-500">-</span>}>
                  <span class="truncate text-dimmed">{contact.companyName}</span>
                </Show>
              );
            }
            if (col.id === "phone") {
              const phone = primaryPhone(contact);
              return (
                <Show when={phone} fallback={<span class="text-zinc-400 dark:text-zinc-500">-</span>}>
                  <a href={`tel:${phone!}`} class="text-dimmed hover:text-blue-500" onClick={stopRowSelection}>
                    {phone}
                  </a>
                </Show>
              );
            }
            if (col.id === "email") {
              const email = primaryEmail(contact);
              return (
                <Show when={email} fallback={<span class="text-zinc-400 dark:text-zinc-500">-</span>}>
                  <a href={`mailto:${email!}`} class="truncate text-dimmed hover:text-blue-500" onClick={stopRowSelection}>
                    {email}
                  </a>
                </Show>
              );
            }
            return "";
          }}
        />
      </Show>
    </div>
  );
}
