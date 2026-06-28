import { children, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { hotkeys } from "@valentinkolb/stdlib/solid";
import { prompts } from "../ui";
import { openGlobalSearchHelpDialog, type GlobalSearchHelpApp } from "./GlobalSearchHelpDialog";

export type LayoutHelpTab = {
  id: string;
  title: string;
  icon?: string;
  description?: string;
  order?: number;
  children: JSX.Element;
};

export type LayoutHelpProps = LayoutHelpTab;

const HELP_TABS_EVENT = "cloud:layout-help-tabs";
const LAST_TAB_KEY = "cloud.layoutHelp.activeTab";

declare global {
  interface Window {
    __cloudLayoutHelpTabs?: Map<string, LayoutHelpTab>;
  }
}

const getRegistry = () => {
  if (typeof window === "undefined") return null;
  window.__cloudLayoutHelpTabs ??= new Map<string, LayoutHelpTab>();
  return window.__cloudLayoutHelpTabs;
};

const emitTabsChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(HELP_TABS_EVENT));
};

const readLastTab = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_TAB_KEY);
  } catch {
    return null;
  }
};

const writeLastTab = (id: string) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_TAB_KEY, id);
  } catch {
    // Help still works if localStorage is blocked.
  }
};

const registeredTabs = () => {
  const registry = getRegistry();
  if (!registry) return [];
  return [...registry.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));
};

const iconClass = (icon?: string) => (icon?.startsWith("ti ") ? icon : `ti ${icon ?? "ti-circle"}`);

export function registerLayoutHelpTab(tab: LayoutHelpTab) {
  const registry = getRegistry();
  if (!registry) return () => {};
  registry.set(tab.id, tab);
  emitTabsChanged();
  return () => {
    if (registry.get(tab.id) === tab) {
      registry.delete(tab.id);
      emitTabsChanged();
    }
  };
}

export function LayoutHelp(props: LayoutHelpProps) {
  const resolved = children(() => props.children);

  onMount(() => {
    const dispose = registerLayoutHelpTab({
      id: props.id,
      title: props.title,
      icon: props.icon,
      description: props.description,
      order: props.order,
      children: resolved(),
    });
    onCleanup(dispose);
  });

  return null;
}

const ShortcutsHelp = (props: { openSearchHelp: () => void }) => {
  const entries = createMemo(() =>
    [...hotkeys.entries()].sort((a, b) => {
      const labelSort = a.label.localeCompare(b.label);
      return labelSort !== 0 ? labelSort : a.keys.localeCompare(b.keys);
    }),
  );

  return (
    <div class="space-y-4">
      <div class="info-block-info flex items-start gap-2 text-xs">
        <i class="ti ti-info-circle mt-0.5 shrink-0" />
        <span>Shortcuts change with the current app and view. This list updates automatically.</span>
      </div>

      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
        onClick={props.openSearchHelp}
      >
        <i class="ti ti-search text-sm" />
        Show search help
      </button>

      <div class="flex flex-col gap-2">
        <For each={entries()}>
          {(entry) => (
            <div class="rounded-lg bg-zinc-50/80 p-2.5 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-900/45 dark:ring-zinc-800">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-primary">{entry.label}</p>
                  <p class="mt-0.5 text-xs text-dimmed">{entry.desc || "No description provided."}</p>
                </div>
                <div
                  class="flex shrink-0 items-center gap-1.5"
                  role="group"
                  aria-label={entry.keysPretty.map((part) => part.ariaLabel).join(" + ")}
                >
                  <For each={entry.keysPretty}>
                    {(part) => (
                      <kbd class="inline-flex min-w-6 justify-center rounded-md bg-white px-1.5 py-1 text-[11px] font-medium leading-none text-primary ring-1 ring-inset ring-zinc-300 dark:bg-zinc-950 dark:ring-zinc-700">
                        {part.key}
                      </kbd>
                    )}
                  </For>
                </div>
              </div>
            </div>
          )}
        </For>
        <Show when={entries().length === 0}>
          <div class="rounded-lg bg-zinc-50/80 p-3 text-xs text-dimmed ring-1 ring-inset ring-zinc-200 dark:bg-zinc-900/45 dark:ring-zinc-800">
            No shortcuts registered yet.
          </div>
        </Show>
      </div>
    </div>
  );
};

const LayoutHelpDialog = (props: { close: () => void; searchHelpApps: GlobalSearchHelpApp[] }) => {
  const [externalTabs, setExternalTabs] = createSignal(registeredTabs());
  const allTabs = createMemo<LayoutHelpTab[]>(() => [
    {
      id: "shortcuts",
      title: "Shortcuts",
      icon: "ti ti-keyboard",
      description: "Keyboard actions for the current page.",
      order: 0,
      children: (
        <ShortcutsHelp
          openSearchHelp={() => {
            props.close();
            queueMicrotask(() => openGlobalSearchHelpDialog(props.searchHelpApps));
          }}
        />
      ),
    },
    ...externalTabs(),
  ]);
  const initialTab = () => {
    const last = readLastTab();
    return allTabs().some((tab) => tab.id === last) ? last! : (allTabs()[0]?.id ?? "shortcuts");
  };
  const [activeId, setActiveId] = createSignal(initialTab());

  onMount(() => {
    const update = () => setExternalTabs(registeredTabs());
    window.addEventListener(HELP_TABS_EVENT, update);
    update();
    onCleanup(() => window.removeEventListener(HELP_TABS_EVENT, update));
  });

  createEffect(() => {
    const tabs = allTabs();
    if (!tabs.some((tab) => tab.id === activeId())) {
      const last = readLastTab();
      setActiveId(tabs.some((tab) => tab.id === last) ? last! : (tabs[0]?.id ?? "shortcuts"));
    }
  });

  const selectTab = (id: string) => {
    setActiveId(id);
    writeLastTab(id);
  };

  return (
    <div class="flex h-[min(90vh,52rem)] w-full flex-col gap-3">
      <div class="paper flex items-center justify-between gap-4 px-5 py-4">
        <div class="flex min-w-0 items-center gap-3">
          <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white">
            <i class="ti ti-help text-xl" />
          </div>
          <div class="min-w-0">
            <h2 class="truncate text-lg font-semibold text-primary">Help</h2>
            <p class="truncate text-sm text-dimmed">Shortcuts, app help, and guides.</p>
          </div>
        </div>
        <button type="button" class="icon-btn ml-auto shrink-0" onClick={props.close} aria-label="Close help">
          <i class="ti ti-x" />
        </button>
      </div>

      <div class="grid min-h-0 flex-1 gap-3 md:grid-cols-[14rem_1fr]">
        <nav class="paper flex gap-1 overflow-x-auto p-2 md:min-h-0 md:flex-col md:overflow-visible" aria-label="Help topics">
          <For each={allTabs()}>
            {(tab) => {
              const active = () => tab.id === activeId();
              return (
                <button
                  type="button"
                  class={`flex min-w-40 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition md:min-w-0 ${
                    active()
                      ? "bg-blue-50 text-blue-600 dark:bg-blue-950/45 dark:text-blue-300"
                      : "text-dimmed hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-900"
                  }`}
                  onClick={() => selectTab(tab.id)}
                >
                  <i class={`${iconClass(tab.icon)} shrink-0 text-base`} />
                  <span class="min-w-0 flex-1 truncate">{tab.title}</span>
                </button>
              );
            }}
          </For>
        </nav>

        <section class="paper min-h-0 overflow-hidden">
          <For each={allTabs()}>
            {(tab) => (
              <div class={`${tab.id === activeId() ? "block" : "hidden"} h-full overflow-y-auto px-5 py-5 pr-4`}>
                <div class="mb-5 flex items-start gap-3">
                  <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    <i class={`${iconClass(tab.icon)} text-lg`} />
                  </div>
                  <div class="min-w-0">
                    <h3 class="text-base font-semibold text-primary">{tab.title}</h3>
                    <Show when={tab.description}>
                      <p class="mt-0.5 text-sm text-dimmed">{tab.description}</p>
                    </Show>
                  </div>
                </div>
                {tab.children}
              </div>
            )}
          </For>
        </section>
      </div>
    </div>
  );
};

export function openLayoutHelpDialog(searchHelpApps: GlobalSearchHelpApp[] = []) {
  void prompts.dialog<void>((close) => <LayoutHelpDialog close={close} searchHelpApps={searchHelpApps} />, {
    surface: "bare",
    header: false,
    size: "wide",
  });
}
