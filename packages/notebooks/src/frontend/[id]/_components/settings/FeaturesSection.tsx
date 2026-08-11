import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { CheckboxCard, NoticeCard, prompts, SettingsGroup } from "@k2b/ui";
import { createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import type { Notebook } from "../sidebar/types";
import { readSettings, writeSettings } from "./NotebookSettingsStore";
import { SaveStatus, settingsChoiceClass } from "./shared";
import { readErrorMessage } from "./utils";

function ViewSection(props: { notebook: Notebook }) {
  const [mode, setMode] = createSignal(readSettings(props.notebook.id).sidebarMode);

  const selectMode = (next: "simple" | "navigator") => {
    if (next === mode()) return;
    setMode(next);
    writeSettings(props.notebook.id, { sidebarMode: next });
    refreshCurrentPath();
  };

  const handleModeKeyDown = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    selectMode(event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "Home" ? "simple" : "navigator");
  };

  return (
    <div class="grid grid-cols-1 gap-2 md:grid-cols-2" role="radiogroup" aria-label="Sidebar mode">
      <button
        type="button"
        role="radio"
        aria-checked={mode() === "simple"}
        tabIndex={mode() === "simple" ? 0 : -1}
        class={settingsChoiceClass(mode() === "simple")}
        onClick={() => selectMode("simple")}
        onKeyDown={handleModeKeyDown}
      >
        <span class="flex items-center gap-2 text-sm font-semibold">
          <i class="ti ti-layout-sidebar" />
          Simple sidebar
        </span>
        <span class="mt-1 block text-xs text-dimmed">A compact note tree with quick actions.</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode() === "navigator"}
        tabIndex={mode() === "navigator" ? 0 : -1}
        class={settingsChoiceClass(mode() === "navigator")}
        onClick={() => selectMode("navigator")}
        onKeyDown={handleModeKeyDown}
      >
        <span class="flex items-center gap-2 text-sm font-semibold">
          <i class="ti ti-layout-list" />
          Navigator
        </span>
        <span class="mt-1 block text-xs text-dimmed">Roots, tags, favorites, and a metadata-rich note list.</span>
      </button>
    </div>
  );
}

export function FeaturesSection(props: { notebook: Notebook; isAdmin: boolean; onNotebookChange: (notebook: Notebook) => void }) {
  const [enabled, setEnabled] = createSignal(props.notebook.scriptsEnabled);
  const [saved, setSaved] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const mutation = mutations.create<Notebook, boolean>({
    mutation: async (next) => {
      const res = await apiClient[":id"].$patch({
        param: { id: props.notebook.id },
        json: { scriptsEnabled: next },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update scripting setting."));
      return (await res.json()) as Notebook;
    },
    onSuccess: (next) => {
      setEnabled(next.scriptsEnabled);
      setSaved(true);
      setError(null);
      props.onNotebookChange(next);
    },
    onError: (err) => {
      setEnabled(props.notebook.scriptsEnabled);
      setSaved(false);
      setError(err.message);
      prompts.error(err.message);
    },
  });

  const setScriptsEnabled = async (next: boolean) => {
    if (next && !enabled()) {
      const confirmed = await prompts.confirm(
        `Script blocks run trusted JavaScript in the browser of every user who opens notes in this notebook. They can read notebook content visible to that user, use script APIs, call browser APIs, and perform notebook actions with that user's permissions.\n\nOnly enable scripts for notebooks where you trust the content and the people who can edit it.\n\nEnable scripting in "${props.notebook.name}"?`,
        {
          title: "Enable scripting",
          icon: "ti ti-alert-triangle",
          variant: "danger",
          confirmText: "Enable",
        },
      );
      if (!confirmed) return;
    }
    setEnabled(next);
    setSaved(false);
    setError(null);
    mutation.mutate(next);
  };

  return (
    <>
      <SettingsGroup title="Your view" description="Stored in this browser and applied immediately.">
        <ViewSection notebook={props.notebook} />
        <SaveStatus loading={false} saved error={null} label="Saved in this browser" />
      </SettingsGroup>

      <SettingsGroup title="Notebook behavior" description="Shared with everyone who opens this notebook. Admin changes save immediately.">
        <CheckboxCard
          label="Enable script blocks"
          description="Allows ```script fences to run trusted JavaScript for everyone who opens this notebook."
          icon="ti ti-code"
          value={enabled}
          onValueChange={setScriptsEnabled}
          disabled={!props.isAdmin || mutation.loading()}
        />
        <NoticeCard tone="warning" icon={false} bodyClass="flex items-start gap-2">
          <i class="ti ti-alert-triangle mt-0.5 shrink-0" />
          <span>
            Scripts run in each viewer's browser. They are not sandboxed and can use browser APIs, read notebook content visible to that
            viewer, and perform notebook actions with that viewer's permissions.
          </span>
        </NoticeCard>
        <SaveStatus loading={mutation.loading()} saved={saved()} error={error()} />
      </SettingsGroup>
    </>
  );
}
