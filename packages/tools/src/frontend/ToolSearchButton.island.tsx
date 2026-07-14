import {
  isSpotlightShortcut,
  openSpotlightSearch,
  SpotlightButton,
  SPOTLIGHT_SHORTCUT_TITLE,
  type SpotlightButtonVariant,
} from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { fuzzy } from "@valentinkolb/stdlib";
import { onCleanup, onMount } from "solid-js";
import { categories, categoryOrder, tools, toolSearchText, type ToolDef } from "./tools/registry";

type Props = {
  variant?: SpotlightButtonVariant;
  registerShortcut?: boolean;
};

const categoryRank = new Map(categoryOrder.map((category, index) => [category, index]));

const orderedTools = [...tools].sort((a, b) => {
  if (Boolean(a.featured) !== Boolean(b.featured)) return a.featured ? -1 : 1;
  const categoryDiff = (categoryRank.get(a.category) ?? 0) - (categoryRank.get(b.category) ?? 0);
  return categoryDiff === 0 ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : categoryDiff;
});

const toolHref = (tool: ToolDef) => `/tools/${tool.id}`;

export default function ToolSearchButton(props: Props) {
  const openSearch = async () => {
    const selected = await openSpotlightSearch<ToolDef>({
      title: "Search tools",
      icon: "ti ti-tools",
      placeholder: "Search tools...",
      minQueryLength: 0,
      noResultsText: "No tools found.",
      resolve: ({ query }) => {
        const needle = query.trim().toLowerCase();
        const matches = needle ? fuzzy.filter(needle, orderedTools, { key: toolSearchText }).map((hit) => hit.item) : orderedTools;

        return matches.map((tool) => ({
          value: tool,
          label: tool.name,
          desc: `${categories[tool.category].label} - ${tool.description}`,
          icon: tool.icon,
        }));
      },
    });

    if (selected?.value) navigateTo(toolHref(selected.value));
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
      label="Search Tools"
      onClick={openSearch}
      title={`Search tools (${SPOTLIGHT_SHORTCUT_TITLE})`}
      ariaLabel="Search tools"
    />
  );
}
