import { For, Show, createSignal, onMount } from "solid-js";
import { InputsTab } from "./lab/inputs";
import { SurfacesCardsTab } from "./lab/surfaces-cards";
import { FeedbackTab } from "./lab/feedback";
import { ButtonsTab } from "./lab/buttons";
import { NavigationTab } from "./lab/navigation";
import { ContentTab } from "./lab/content";
import type { Tab } from "./lab/tabs";
import { DEFAULT_TAB_ID } from "./lab/tabs";

type UiLabProps = {
  /** Pre-rendered markdown HTML for the MarkdownView demo. Server-side
   * markdown rendering needs Node APIs, so we hand it in from page.tsx
   * rather than building it client-side. */
  markdownHtml: string;
};

/**
 * UI Lab orchestrator — owns the tab signal, the URL state, and the
 * scroll-into-view dance on initial load. Everything else lives in
 * the per-tab files under `./lab/`.
 *
 * URL contract:
 *   - `?tab=<id>` selects the active tab (default: "inputs")
 *   - `#<demo-id>` after the hash scrolls to a specific DemoCard
 *   - Tab switches use `history.replaceState` (no reload, no SPA-style
 *     pushState entry per click — back/forward should jump out of the
 *     lab as expected)
 */
export default function UiLab(props: UiLabProps) {
  const tabs: Tab[] = [
    { id: "inputs", label: "Inputs", description: "Form primitives — typed values, reactive props, error states.", render: () => <InputsTab /> },
    { id: "surfaces-cards", label: "Surfaces & Cards", description: "Surface utilities, identity rows, stat blocks, and composed dashboard widgets.", render: () => <SurfacesCardsTab /> },
    { id: "feedback", label: "Feedback", description: "Info blocks, badges, prompts, toasts — anything that communicates state.", render: () => <FeedbackTab /> },
    { id: "buttons", label: "Buttons", description: "Button utility classes and button-flavoured components.", render: () => <ButtonsTab /> },
    { id: "navigation", label: "Navigation", description: "Sidebar layouts, pagination, filter chips.", render: () => <NavigationTab /> },
    { id: "content", label: "Content", description: "Rich content — charts, markdown rendering, the standalone editor.", render: () => <ContentTab markdownHtml={props.markdownHtml} /> },
  ];

  const resolveInitialTabId = (): string => {
    if (typeof window === "undefined") return DEFAULT_TAB_ID;
    const param = new URLSearchParams(window.location.search).get("tab");
    if (param && tabs.some((t) => t.id === param)) return param;
    return DEFAULT_TAB_ID;
  };

  const [activeId, setActiveId] = createSignal(resolveInitialTabId());
  const activeTab = (): Tab => tabs.find((t) => t.id === activeId()) ?? tabs[0]!;

  const switchTab = (id: string): void => {
    if (id === activeId()) return;
    setActiveId(id);
    // Update URL without reload. Drop any old hash since it refers to a
    // demo that probably doesn't exist in the new tab.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    url.hash = "";
    window.history.replaceState(null, "", url.toString());
    // Scroll back to top of the tab content — otherwise we land mid-page
    // wherever the user was before.
    window.scrollTo({ top: 0 });
  };

  onMount(() => {
    // Honour the URL anchor on first paint. Two frames so layout has
    // settled (especially after dynamic tab content renders).
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(hash)?.scrollIntoView({ block: "start" });
      });
    });
  });

  return (
    <div class="flex flex-col gap-4 max-w-6xl mx-auto py-4 px-3 md:px-6">
      <header class="paper p-4 md:p-5">
        <h1 class="text-base font-semibold flex items-center gap-2">
          <i class="ti ti-palette text-blue-500" />
          UI Lab
        </h1>
        <p class="text-xs text-dimmed mt-1">
          Showcase of every shared component and CSS utility in the Cloud design system. Click a chip to copy the
          import / class name. Use the
          <span class="font-mono mx-1">[Code]</span>
          toggle on any demo to see the snippet, the
          <i class="ti ti-link mx-1" />
          to copy a deep-link to a specific demo.
        </p>
      </header>

      {/* Tab bar — sticky so it stays reachable while scrolling. */}
      <nav
        class="sticky top-0 z-10 -mx-3 md:-mx-6 px-3 md:px-6 py-2 backdrop-blur"
        role="tablist"
        aria-label="UI Lab sections"
      >
        <div class="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <For each={tabs}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={activeId() === tab.id}
                class="px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors"
                classList={{
                  "bg-zinc-100 dark:bg-zinc-800 text-primary": activeId() === tab.id,
                  "text-dimmed hover:text-secondary": activeId() !== tab.id,
                }}
                onClick={() => switchTab(tab.id)}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>
      </nav>

      <section class="flex flex-col gap-4">
        <div>
          <h2 class="text-lg font-semibold">{activeTab().label}</h2>
          <Show when={activeTab().description}>
            <p class="text-sm text-dimmed mt-1">{activeTab().description}</p>
          </Show>
        </div>
        {activeTab().render()}
      </section>
    </div>
  );
}
