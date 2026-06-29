import {
  isSpotlightShortcut,
  openSpotlightSearch,
  SpotlightButton,
  SPOTLIGHT_SHORTCUT_TITLE,
  type SpotlightButtonVariant,
} from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { onCleanup, onMount } from "solid-js";
import { apiClient } from "@/api/client";
import type { Contact } from "../../service";
import { resolveContactName } from "../../shared";

type Props = {
  variant?: SpotlightButtonVariant;
  registerShortcut?: boolean;
};

const PER_PAGE = 20;

const primaryDetail = (contact: Contact): string | undefined => {
  const email = contact.emails[0]?.email;
  if (email) return email;
  const phone = contact.phones[0]?.phone;
  if (phone) return phone;
  return [contact.companyName, contact.jobTitle].filter(Boolean).join(" · ") || undefined;
};

const contactHref = (contact: Contact): string => `/app/contacts/${contact.bookId}?contact=${contact.id}&contactBook=${contact.bookId}`;

export default function ContactsSpotlightButton(props: Props) {
  const openSearch = async () => {
    const selected = await openSpotlightSearch<Contact>({
      title: "Search contacts",
      icon: "ti ti-address-book",
      placeholder: "Search contacts...",
      minQueryLength: 1,
      noResultsText: "No contacts found.",
      resolve: async ({ query, abortSignal }) => {
        const trimmed = query.trim();
        if (!trimmed) return [];

        const response = await apiClient.search.$get(
          {
            query: {
              q: trimmed,
              includeSystem: "false",
              page: "1",
              per_page: String(PER_PAGE),
            },
          },
          { init: { signal: abortSignal } },
        );
        if (!response.ok) return [];

        const payload = await response.json();
        return payload.data.map((contact) => ({
          value: contact,
          label: resolveContactName(contact),
          desc: primaryDetail(contact),
          icon: "ti ti-address-book",
        }));
      },
    });

    if (selected?.value) navigateTo(contactHref(selected.value));
  };

  onMount(() => {
    if (!props.registerShortcut) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSpotlightShortcut(event)) return;
      event.preventDefault();
      void openSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <SpotlightButton
      variant={props.variant}
      label="Search Contacts"
      onClick={openSearch}
      title={`Search contacts (${SPOTLIGHT_SHORTCUT_TITLE})`}
      ariaLabel="Search contacts"
    />
  );
}
