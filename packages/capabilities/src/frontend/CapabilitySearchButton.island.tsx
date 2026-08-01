import { navigateTo } from "@k2b/ssr/nav";
import { isSpotlightShortcut, openSpotlightSearch, SPOTLIGHT_SHORTCUT_TITLE, SpotlightButton, type SpotlightButtonVariant } from "@k2b/ui";
import { onCleanup, onMount } from "solid-js";

export type CapabilitySearchEntry = {
  href: string;
  label: string;
  description: string;
  icon: string;
};

type Props = {
  entries: CapabilitySearchEntry[];
  variant?: SpotlightButtonVariant;
  registerShortcut?: boolean;
};

export default function CapabilitySearchButton(props: Props) {
  const openSearch = async () => {
    const selected = await openSpotlightSearch<CapabilitySearchEntry>({
      title: "Search capabilities",
      icon: "ti ti-api-app",
      placeholder: "Search apps, queries, and actions...",
      noResultsText: "No matching capabilities.",
      resolve: ({ query }) => {
        const needle = query.trim().toLocaleLowerCase();
        return props.entries
          .filter((entry) => !needle || `${entry.label} ${entry.description}`.toLocaleLowerCase().includes(needle))
          .map((entry) => ({
            value: entry,
            label: entry.label,
            desc: entry.description,
            icon: entry.icon,
          }));
      },
    });

    if (selected?.value) navigateTo(selected.value.href);
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
      variant={props.variant ?? "chip"}
      label="Search capabilities"
      ariaLabel="Search capabilities"
      title={`Search capabilities (${SPOTLIGHT_SHORTCUT_TITLE})`}
      onClick={openSearch}
    />
  );
}
