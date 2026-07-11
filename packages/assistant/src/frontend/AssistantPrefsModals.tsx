import type { AiUserPrefs } from "@valentinkolb/cloud/ai";
import { dialogCore, PanelDialog, panelDialogOptions, prompts, Switch, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, Match, Show, Switch as SolidSwitch } from "solid-js";
import { assistantApi } from "../api/client";

// Kept in sync with AI_USER_*_MAX_CHARS in @valentinkolb/cloud/ai/prefs — the
// server clamps too; these are value constants and must not be imported from
// the server-only ai index in browser code.
const INSTRUCTIONS_MAX_CHARS = 4_000;
const MEMORY_MAX_CHARS = 24_000;

export type AssistantPrefsTab = "personalization" | "memory";

function SystemPromptDisclosure() {
  const [prompt, setPrompt] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const load = async () => {
    if (prompt() || error()) return;
    try {
      setPrompt((await assistantApi.getSystemPromptPreview()).prompt);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load system prompt");
    }
  };

  return (
    <details class="group" onToggle={(event) => event.currentTarget.open && void load()}>
      <summary class="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary">
        <i class="ti ti-chevron-right transition-transform group-open:rotate-90" aria-hidden="true" />
        Show the current system prompt
      </summary>
      <div class="mt-2 flex flex-col gap-1.5">
        <p class="text-xs text-dimmed">
          This is what a new Assistant chat starts with right now — including your instructions and memories. Use it to see what is already
          covered before adding your own instructions.
        </p>
        <Show when={error()}>
          <p class="text-xs text-red-600 dark:text-red-400">{error()}</p>
        </Show>
        <Show
          when={prompt()}
          fallback={
            <Show when={!error()}>
              <p class="text-xs text-dimmed">Loading…</p>
            </Show>
          }
        >
          <pre class="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-50 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-700 [box-shadow:var(--theme-recess)] dark:bg-zinc-900 dark:text-zinc-300">
            {prompt()}
          </pre>
        </Show>
      </div>
    </details>
  );
}

/**
 * One dialog for both personal AI settings, tabbed like the skill editor.
 * A single form state spans the tabs so switching never loses edits, and one
 * save button persists everything in one request.
 */
function PrefsDialog(props: { prefs: AiUserPrefs; initialTab: AssistantPrefsTab; close: () => void }) {
  const [tab, setTab] = createSignal<AssistantPrefsTab>(props.initialTab);
  const [instructions, setInstructions] = createSignal(props.prefs.instructions);
  const [memory, setMemory] = createSignal(props.prefs.memory);
  const [memoryEnabled, setMemoryEnabled] = createSignal(props.prefs.memoryEnabled);

  const dirty = () =>
    instructions().trim() !== props.prefs.instructions.trim() ||
    memory().trim() !== props.prefs.memory.trim() ||
    memoryEnabled() !== props.prefs.memoryEnabled;

  const save = mutation.create<AiUserPrefs, void>({
    mutation: async () =>
      assistantApi.updatePrefs({ instructions: instructions().trim(), memory: memory().trim(), memoryEnabled: memoryEnabled() }),
    onSuccess: () => {
      toast.success("Preferences saved");
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });
  const busy = save.loading;

  return (
    <PanelDialog>
      <form
        aria-busy={busy()}
        onSubmit={(event) => {
          event.preventDefault();
          void save.mutate(undefined);
        }}
      >
        <PanelDialog.Header
          title="Personalization"
          subtitle="How the assistant addresses you, and what it remembers."
          icon="ti ti-user-cog"
          close={() => props.close()}
          closeDisabled={busy()}
        />
        <PanelDialog.Body>
          <PanelDialog.Tabs
            ariaLabel="Preference sections"
            options={[
              { value: "personalization", label: "Instructions", icon: "ti ti-user-cog" },
              { value: "memory", label: "Memory", icon: "ti ti-brain" },
            ]}
            value={tab}
            onChange={setTab}
          />

          {/* Fixed-height content: switching tabs must never resize the dialog. */}
          <div class="flex h-[min(55vh,26rem)] min-h-0 flex-col gap-3 overflow-y-auto">
            <SolidSwitch>
              <Match when={tab() === "personalization"}>
                <TextInput
                  label="Custom instructions"
                  description="Added to every new chat. Tell the assistant who you are, how to answer, and what to focus on."
                  value={instructions}
                  onInput={setInstructions}
                  markdown
                  lines={9}
                  maxLength={INSTRUCTIONS_MAX_CHARS}
                  placeholder={"I study computer science and prefer short, technical answers.\nAlways answer in German."}
                  disabled={busy()}
                />
                <SystemPromptDisclosure />
              </Match>
              <Match when={tab() === "memory"}>
                <Switch
                  label="Let the assistant remember things about you"
                  value={memoryEnabled}
                  onChange={setMemoryEnabled}
                  disabled={busy()}
                />
                <TextInput
                  label="Memories"
                  description="One memory per line, stamped with the date it was saved. The assistant reads this list in every chat and can add or remove entries."
                  value={memory}
                  onInput={setMemory}
                  markdown
                  lines={9}
                  maxLength={MEMORY_MAX_CHARS}
                  placeholder={"Studies computer science at Uni Ulm.\nPrefers answers in German."}
                  disabled={busy()}
                />
              </Match>
            </SolidSwitch>
          </div>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <span />
          <div class="flex items-center gap-2">
            <button type="button" class="btn-secondary btn-sm" disabled={busy()} onClick={() => props.close()}>
              Cancel
            </button>
            <button type="submit" class="btn-primary btn-sm" disabled={busy() || !dirty()}>
              <i class={save.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} />
              Save
            </button>
          </div>
        </PanelDialog.Footer>
      </form>
    </PanelDialog>
  );
}

export const openAssistantPrefsModal = async (initialTab: AssistantPrefsTab = "personalization"): Promise<void> => {
  let prefs: AiUserPrefs;
  try {
    prefs = await assistantApi.getPrefs();
  } catch (error) {
    await prompts.error(error instanceof Error ? error.message : "Failed to load AI preferences");
    return;
  }
  await dialogCore.open<void>((close) => <PrefsDialog prefs={prefs} initialTab={initialTab} close={() => close()} />, {
    ...panelDialogOptions,
    cancelBehavior: "ignore",
  });
};

/** @deprecated Use openAssistantPrefsModal — both preference areas live in one tabbed dialog now. */
export const openAssistantPersonalizationModal = (): Promise<void> => openAssistantPrefsModal("personalization");
/** @deprecated Use openAssistantPrefsModal — both preference areas live in one tabbed dialog now. */
export const openAssistantMemoryModal = (): Promise<void> => openAssistantPrefsModal("memory");
