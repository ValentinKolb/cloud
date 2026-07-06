import {
  isSpotlightShortcut,
  openSpotlightSearch,
  SpotlightButton,
  SPOTLIGHT_SHORTCUT_TITLE,
  type SpotlightButtonVariant,
} from "@valentinkolb/cloud/ui";
import { apiClient as coreClient } from "@valentinkolb/cloud/clients/core";
import type { EntityKind, EntityListItem } from "@valentinkolb/cloud/contracts";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { onCleanup, onMount } from "solid-js";

type Props = {
  isAdmin: boolean;
  variant?: SpotlightButtonVariant;
  registerShortcut?: boolean;
};

const PAGE_SIZE = 20;

const entityLabel = (item: EntityListItem): string => {
  switch (item.kind) {
    case "user":
      return item.user.displayName || item.user.mail || item.user.uid;
    case "group":
      return item.group.name;
    case "service_account":
      return item.serviceAccount.name;
  }
};

const entityDescription = (item: EntityListItem): string => {
  switch (item.kind) {
    case "user":
      return [item.user.uid, item.user.mail, item.user.provider, item.user.profile].filter(Boolean).join(" - ");
    case "group":
      return [item.group.description || "Group", item.group.provider].join(" - ");
    case "service_account":
      return [
        item.serviceAccount.kind === "user_delegated" ? "User-bound service account" : "Resource-bound service account",
        item.serviceAccount.status,
      ].join(" - ");
  }
};

const entityIcon = (item: EntityListItem): string => {
  switch (item.kind) {
    case "user":
      return "ti ti-user";
    case "group":
      return "ti ti-users-group";
    case "service_account":
      return "ti ti-user-key";
  }
};

const entityHref = (item: EntityListItem): string => {
  switch (item.kind) {
    case "user":
      return `/app/accounts/users/${item.user.id}`;
    case "group":
      return `/app/accounts/groups/${item.group.id}`;
    case "service_account":
      return `/app/accounts/service-accounts?search=${encodeURIComponent(item.serviceAccount.name)}`;
  }
};

const searchKinds = (isAdmin: boolean): EntityKind[] => (isAdmin ? ["user", "group", "service_account"] : ["group"]);

export default function AccountsSearchButton(props: Props) {
  const openSearch = async () => {
    const kinds = searchKinds(props.isAdmin);
    const selected = await openSpotlightSearch<EntityListItem>({
      title: "Search accounts",
      icon: "ti ti-users-group",
      placeholder: props.isAdmin ? "Search users, groups, service accounts..." : "Search groups...",
      minQueryLength: 1,
      noResultsText: "No accounts found.",
      resolve: async ({ query, abortSignal }) => {
        const trimmed = query.trim();
        if (!trimmed) return [];

        const response = await coreClient.accounts.entities.$get(
          {
            query: {
              search: trimmed,
              kinds: kinds.join(","),
              per_page: String(PAGE_SIZE),
            },
          },
          { init: { signal: abortSignal } },
        );
        if (!response.ok) return [];

        const payload = await response.json();
        return payload.items.map((item) => ({
          value: item,
          label: entityLabel(item),
          desc: entityDescription(item),
          icon: entityIcon(item),
        }));
      },
    });

    if (selected?.value) navigateTo(entityHref(selected.value));
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
      label="Search Accounts"
      icon="ti ti-search"
      onClick={openSearch}
      title={`Search accounts (${SPOTLIGHT_SHORTCUT_TITLE})`}
      ariaLabel="Search accounts"
    />
  );
}
