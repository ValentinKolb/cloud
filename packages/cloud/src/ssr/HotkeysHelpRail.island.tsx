import { For, Show, createMemo } from "solid-js";
import { hotkeys } from "@valentinkolb/stdlib/solid";
import { prompts } from "../ui";
import { openGlobalSearchHelpDialog, type GlobalSearchHelpApp } from "./GlobalSearchHelpDialog";

const ShortcutsDialog = (props: { openSearchHelp: () => void }) => {
  const entries = createMemo(() =>
    [...hotkeys.entries()].sort((a, b) => {
      const labelSort = a.label.localeCompare(b.label);
      return labelSort !== 0 ? labelSort : a.keys.localeCompare(b.keys);
    }),
  );

  return (
    <div class="flex flex-col gap-3">
      <p class="text-xs text-dimmed leading-relaxed">
        Use these keyboard shortcuts to work faster. The list updates automatically depending on which app or view is currently open.
      </p>
      <p class="text-xs text-dimmed leading-relaxed">
        Looking for the Spotlight/search{" "}
        <button type="button" class="text-blue-500 hover:underline dark:text-blue-400" onClick={props.openSearchHelp}>
          help
        </button>
      </p>

      <div class="max-h-[60vh] overflow-y-auto pr-1">
        <div class="flex flex-col gap-2">
          <For each={entries()}>
            {(entry) => (
              <div class="rounded-lg ring-1 ring-inset ring-zinc-200 dark:ring-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-900/35">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-primary truncate">{entry.label}</p>
                    <p class="text-xs text-dimmed mt-0.5">{entry.desc || "No description provided."}</p>
                  </div>
                  <div
                    class="flex items-center gap-1.5 shrink-0"
                    role="group"
                    aria-label={entry.keysPretty.map((part) => part.ariaLabel).join(" + ")}
                  >
                    <For each={entry.keysPretty}>
                      {(part) => (
                        <kbd class="inline-flex min-w-6 justify-center px-1.5 py-1 rounded-md text-[11px] leading-none font-medium ring-1 ring-inset ring-zinc-300 dark:ring-zinc-700 bg-white dark:bg-zinc-900 text-primary">
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
            <div class="rounded-lg ring-1 ring-inset ring-zinc-200 dark:ring-zinc-800 p-3 text-xs text-dimmed bg-zinc-50/50 dark:bg-zinc-900/35">
              No shortcuts registered yet.
            </div>
          </Show>
        </div>
      </div>

    </div>
  );
};

/** Help action in rail nav: opens a modal with all currently registered hotkeys. */
export default function HotkeysHelpRail(props: { searchHelpApps?: GlobalSearchHelpApp[] }) {
  const searchHelpApps = props.searchHelpApps ?? [];

  const openHelp = () => {
    void prompts.dialog<void>((close) => <ShortcutsDialog openSearchHelp={() => {
      close();
      queueMicrotask(() => openGlobalSearchHelpDialog(searchHelpApps));
    }} />, {
      title: "Keyboard Shortcuts",
      icon: "ti ti-keyboard",
      size: "large",
    });
  };

  hotkeys.create(() => ({
    "shift+/": {
      label: "Open shortcut help",
      desc: "Show all currently registered keyboard shortcuts.",
      run: openHelp,
    },
  }));

  return (
    <button
      type="button"
      class="rail-item text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-500/10 dark:hover:bg-blue-500/15"
      onClick={openHelp}
      aria-label="Open keyboard shortcuts help"
      title="Keyboard shortcuts (Shift+/)"
    >
      <i class="ti ti-help-circle text-base" />
    </button>
  );
}
