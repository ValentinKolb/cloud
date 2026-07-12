import { Placeholder, Tooltip } from "@valentinkolb/cloud/ui";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Contact } from "../../service";
import { resolveContactInitials, resolveContactName } from "../../shared";
import ContactTagChip from "./ContactTagChip";
import { CONTACT_DETAIL_EVENT, type ContactDetailPayload, getSelectedContactFromUrl, setSelectedContactInUrl } from "./context";

type Props = {
  contacts: Contact[];
  bookNames?: Record<string, string>;
  showBookNames?: boolean;
  initialSelectedContactId: string | null;
  initialSelectedBookId: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
};

const contactKey = (contactId: string | null, bookId: string | null) => (contactId && bookId ? `${bookId}:${contactId}` : null);
const primaryEmail = (contact: Contact) => contact.emails[0]?.email ?? null;
const primaryPhone = (contact: Contact) => contact.phones[0]?.phone ?? null;

const contactContext = (contact: Contact) => {
  const parts = [contact.jobTitle, contact.companyName].filter(Boolean) as string[];
  return [...new Set(parts)].join(" · ");
};

export default function ContactsList(props: Props) {
  const [selectedKey, setSelectedKey] = createSignal<string | null>(
    contactKey(props.initialSelectedContactId, props.initialSelectedBookId),
  );

  const selectContact = (contact: Contact) => {
    setSelectedKey(contactKey(contact.id, contact.bookId));
    setSelectedContactInUrl({ contactId: contact.id, bookId: contact.bookId, contact });
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
    <Show
      when={props.contacts.length > 0}
      fallback={
        <Placeholder
          icon="ti ti-address-book"
          title={props.emptyTitle ?? "No contacts"}
          description={props.emptyDescription ?? "No contacts are available in this view."}
          variant="panel"
          class="h-full min-h-56 justify-center"
        />
      }
    >
      <ul class="divide-y divide-[var(--ui-data-row-divider)]" aria-label="Contacts">
        <For each={props.contacts}>
          {(contact) => {
            const name = () => resolveContactName(contact);
            const email = () => primaryEmail(contact);
            const phone = () => primaryPhone(contact);
            const context = () => contactContext(contact);
            const isSelected = () => selectedKey() === contactKey(contact.id, contact.bookId);
            const visibleTags = () => contact.tags.slice(0, 2);
            const hiddenTagCount = () => Math.max(0, contact.tags.length - visibleTags().length);

            return (
              <li class="group/contact relative">
                <button
                  type="button"
                  class="flex w-full min-w-0 items-center gap-3 border-l-2 border-l-transparent px-3 py-2.5 pr-20 text-left transition-colors hover:bg-[var(--ui-data-row-hover)] focus-ui sm:px-4 sm:pr-24"
                  classList={{ "border-l-[var(--app-accent)] bg-[var(--ui-data-row-selected)]": isSelected() }}
                  aria-label={`Open ${name()}`}
                  aria-pressed={isSelected()}
                  onClick={() => selectContact(contact)}
                >
                  <span
                    class="contact-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    aria-hidden="true"
                  >
                    {resolveContactInitials(contact)}
                  </span>

                  <span class="min-w-0 flex-1">
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="truncate text-sm font-medium text-primary">{name()}</span>
                      <Show when={props.showBookNames && props.bookNames?.[contact.bookId]}>
                        <span class="hidden max-w-36 shrink-0 truncate rounded-full bg-[var(--ui-surface-muted)] px-1.5 py-0.5 text-[11px] text-dimmed md:inline-flex">
                          {props.bookNames?.[contact.bookId]}
                        </span>
                      </Show>
                    </span>

                    <span class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-dimmed">
                      <Show when={context()}>
                        <span class="truncate">{context()}</span>
                      </Show>
                      <Show when={contact.parent}>
                        {(parent) => (
                          <span class="inline-flex min-w-0 items-center gap-1 truncate" title={`Part of ${resolveContactName(parent())}`}>
                            <i class="ti ti-corner-down-right shrink-0 text-[11px]" />
                            <span class="truncate">{resolveContactName(parent())}</span>
                          </span>
                        )}
                      </Show>
                      <For each={visibleTags()}>{(tag) => <ContactTagChip name={tag.name} color={tag.color} />}</For>
                      <Show when={hiddenTagCount() > 0}>
                        <span class="text-[11px] tabular-nums">+{hiddenTagCount()}</span>
                      </Show>
                    </span>
                  </span>

                  <span class="hidden w-52 shrink-0 flex-col items-end gap-0.5 text-xs text-dimmed xl:flex">
                    <Show when={email()}>
                      <span class="max-w-full truncate" title={email() ?? undefined}>
                        {email()}
                      </span>
                    </Show>
                    <Show when={phone()}>
                      <span class="max-w-full truncate tabular-nums" title={phone() ?? undefined}>
                        {phone()}
                      </span>
                    </Show>
                  </span>
                </button>

                <Show when={email() || phone()}>
                  <span class="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 opacity-100 transition-opacity sm:right-4 sm:opacity-0 sm:group-hover/contact:opacity-100 sm:group-focus-within/contact:opacity-100">
                    <Show when={email()}>
                      {(address) => (
                        <Tooltip content={`Email ${name()}`}>
                          <a
                            href={`mailto:${address()}`}
                            class="focus-ui flex h-7 w-7 items-center justify-center rounded text-dimmed hover:bg-[var(--ui-hover)] hover:text-primary"
                            aria-label={`Email ${name()}`}
                          >
                            <i class="ti ti-mail text-sm" />
                          </a>
                        </Tooltip>
                      )}
                    </Show>
                    <Show when={phone()}>
                      {(number) => (
                        <Tooltip content={`Call ${name()}`}>
                          <a
                            href={`tel:${number()}`}
                            class="focus-ui flex h-7 w-7 items-center justify-center rounded text-dimmed hover:bg-[var(--ui-hover)] hover:text-primary"
                            aria-label={`Call ${name()}`}
                          >
                            <i class="ti ti-phone text-sm" />
                          </a>
                        </Tooltip>
                      )}
                    </Show>
                  </span>
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
    </Show>
  );
}
