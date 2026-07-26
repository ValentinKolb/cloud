import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { CatalogComponent } from "./UiCatalogPage";

const components = [
  {
    id: "panel-header",
    name: "PanelHeader",
    keywords: "heading title subtitle actions panel",
  },
  {
    id: "stat-grid",
    name: "StatGrid",
    keywords: "metrics numbers statistics cells dashboard",
  },
  {
    id: "status-badge",
    name: "StatusBadge",
    keywords: "state health tone online error degraded running",
  },
] as const;

type ComponentNavigationProps = {
  active?: CatalogComponent;
};

export default function ComponentNavigation(props: ComponentNavigationProps) {
  const [query, setQuery] = createSignal("");
  let input: HTMLInputElement | undefined;

  const matches = createMemo(() => {
    const normalized = query().trim().toLowerCase();
    if (!normalized) return components;
    return components.filter((component) =>
      `${component.name} ${component.keywords}`.toLowerCase().includes(normalized),
    );
  });

  const linkClass = (active: boolean) =>
    `block border-l-2 py-1.5 pl-4 text-[0.98rem] leading-6 ${
      active
        ? "border-[#d69e2e] font-semibold text-zinc-950 dark:border-[#f6c453] dark:text-white"
        : "border-transparent text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
    }`;

  onMount(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      input?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    onCleanup(() => window.removeEventListener("keydown", focusSearch));
  });

  return (
    <nav class="ui-component-nav space-y-5 text-sm" aria-label="Component catalog">
      <label class="ui-component-search">
        <span class="sr-only">Search components</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m21 21-4.35-4.35M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" />
        </svg>
        <input
          ref={input}
          type="search"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search components"
          autocomplete="off"
        />
        <kbd>/</kbd>
      </label>
      <details class="group" open>
        <summary class="flex cursor-pointer list-none items-center justify-between rounded-md px-1 py-1.5 text-[1.05rem] font-bold text-zinc-800 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white">
          Components
          <span class="grid h-6 w-6 place-items-center text-zinc-400 transition group-open:rotate-90">
            <svg viewBox="0 0 20 20" aria-hidden="true" class="h-5 w-5">
              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m7 5 5 5-5 5" />
            </svg>
          </span>
        </summary>
        <div class="mt-2 space-y-1">
          <Show when={!query().trim()}>
            <a class={linkClass(!props.active)} href="/ui" aria-current={!props.active ? "page" : undefined}>
              Overview
            </a>
          </Show>
          <For each={matches()}>
            {(component) => (
              <a
                class={linkClass(props.active === component.id)}
                href={`/ui/${component.id}`}
                aria-current={props.active === component.id ? "page" : undefined}
              >
                {component.name}
              </a>
            )}
          </For>
          <Show when={matches().length === 0}>
            <p class="px-4 py-2 text-zinc-500 dark:text-zinc-400" aria-live="polite">
              No matching components.
            </p>
          </Show>
        </div>
      </details>
    </nav>
  );
}
