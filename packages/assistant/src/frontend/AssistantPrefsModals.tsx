import type { AiUserPrefs } from "@valentinkolb/cloud/ai";
import { prompts, SettingsModal, Switch, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, Show } from "solid-js";
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

function PrefsDialog(props: { prefs: AiUserPrefs; initialTab: AssistantPrefsTab; close: () => void }) {
  const [instructions, setInstructions] = createSignal(props.prefs.instructions);
  const [memory, setMemory] = createSignal(props.prefs.memory);
  const [memoryEnabled, setMemoryEnabled] = createSignal(props.prefs.memoryEnabled);

  const instructionsDirty = () => instructions().trim() !== props.prefs.instructions.trim();
  const memoryDirty = () => memory().trim() !== props.prefs.memory.trim() || memoryEnabled() !== props.prefs.memoryEnabled;

  const saveInstructions = mutation.create<AiUserPrefs, void>({
    mutation: async () => assistantApi.updatePrefs({ instructions: instructions().trim() }),
    onSuccess: () => {
      toast.success("Instructions saved");
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  const saveMemory = mutation.create<AiUserPrefs, void>({
    mutation: async () => assistantApi.updatePrefs({ memory: memory().trim(), memoryEnabled: memoryEnabled() }),
    onSuccess: () => {
      toast.success("Memory settings saved");
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });
  const busy = () => saveInstructions.loading() || saveMemory.loading();

  return (
    <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
      <SettingsModal title="Personalization" defaultTab={props.initialTab} onClose={props.close} closeLabel="Close personalization">
        <SettingsModal.Tab
          id="personalization"
          title="Instructions"
          icon="ti ti-user-cog"
          description="Choose how the assistant should answer and what it should focus on."
        >
          <form
            class="flex flex-col gap-4"
            aria-busy={busy()}
            onSubmit={(event) => {
              event.preventDefault();
              void saveInstructions.mutate(undefined);
            }}
          >
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
            <div class="flex justify-end pt-2">
              <button type="submit" class="btn-primary btn-sm" disabled={busy() || !instructionsDirty()}>
                <i class={saveInstructions.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} />
                Save instructions
              </button>
            </div>
          </form>
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="memory"
          title="Memory"
          icon="ti ti-brain"
          description="Control what the assistant carries into future conversations."
        >
          <form
            class="flex flex-col gap-4"
            aria-busy={busy()}
            onSubmit={(event) => {
              event.preventDefault();
              void saveMemory.mutate(undefined);
            }}
          >
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
            <div class="flex justify-end pt-2">
              <button type="submit" class="btn-primary btn-sm" disabled={busy() || !memoryDirty()}>
                <i class={saveMemory.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} />
                Save memory
              </button>
            </div>
          </form>
        </SettingsModal.Tab>
      </SettingsModal>
    </div>
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
  await prompts.dialog<void>((close) => <PrefsDialog prefs={prefs} initialTab={initialTab} close={() => close()} />, {
    surface: "bare",
    header: false,
    size: "large",
  });
};

/** @deprecated Use openAssistantPrefsModal — both preference areas live in one tabbed dialog now. */
export const openAssistantPersonalizationModal = (): Promise<void> => openAssistantPrefsModal("personalization");
/** @deprecated Use openAssistantPrefsModal — both preference areas live in one tabbed dialog now. */
export const openAssistantMemoryModal = (): Promise<void> => openAssistantPrefsModal("memory");
