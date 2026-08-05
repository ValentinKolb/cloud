import { mutation } from "@k2b/stdlib/solid";
import { Button, Placeholder, prompts, SettingsModal, Switch, TextInput, toast } from "@k2b/ui";
import type { AiApprovalPreferenceView, AiUserPrefs } from "@valentinkolb/cloud/ai";
import { coreClient } from "@valentinkolb/cloud/clients/core";
import { createResource, createSignal, For, Show } from "solid-js";
import { assistantApi } from "../api/client";

// Kept in sync with AI_USER_*_MAX_CHARS in @valentinkolb/cloud/ai/prefs — the
// server clamps too; these are value constants and must not be imported from
// the server-only ai index in browser code.
const INSTRUCTIONS_MAX_CHARS = 4_000;
const MEMORY_MAX_CHARS = 24_000;

type AssistantPrefsTab = "personalization" | "memory" | "approvals";

const readApiError = async (response: Response, fallback: string): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : fallback;
};

const loadApprovalPreferences = async (): Promise<AiApprovalPreferenceView[]> => {
  const response = await coreClient.ai["approval-preferences"].$get();
  if (!response.ok) throw new Error(await readApiError(response, "Failed to load remembered approvals"));
  return (await response.json()).approvals;
};

function ApprovalPreferences() {
  const [approvals, { refetch }] = createResource(loadApprovalPreferences);
  const [revokingId, setRevokingId] = createSignal<string | null>(null);

  const revoke = async (approval: AiApprovalPreferenceView) => {
    if (revokingId()) return;
    setRevokingId(approval.id);
    try {
      const response = await coreClient.ai["approval-preferences"][":preferenceId"].$delete({
        param: { preferenceId: approval.id },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to revoke approval"));
      await refetch();
      toast.success(`${approval.title} will ask for approval again`);
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Failed to revoke approval");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div class="flex flex-col gap-3" aria-busy={approvals.loading || Boolean(revokingId())}>
      <Show when={approvals.error}>
        <div class="flex items-center justify-between gap-3 rounded-lg border border-red-200 p-3 text-sm dark:border-red-900">
          <span class="text-red-700 dark:text-red-300">{approvals.error.message}</span>
          <Button size="xs" variant="secondary" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      </Show>
      <Show when={approvals.loading}>
        <Placeholder state="loading" title="Loading remembered approvals" />
      </Show>
      <Show when={!approvals.loading && !approvals.error && (approvals()?.length ?? 0) === 0}>
        <Placeholder title="No remembered approvals" description="Actions will ask before they run." />
      </Show>
      <Show when={!approvals.error && (approvals()?.length ?? 0) > 0}>
        <ul class="divide-y overflow-hidden rounded-lg border">
          <For each={approvals()}>
            {(approval) => (
              <li class="flex items-center gap-3 p-3">
                <i
                  class={`${approval.app?.icon ?? "ti ti-tool"} shrink-0 text-lg`}
                  style={{ color: approval.app?.accent }}
                  aria-hidden="true"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-primary">{approval.title}</p>
                  <p class="truncate text-xs text-secondary">
                    {approval.app?.name ?? approval.contextAppId}
                    {approval.resource ? ` · ${approval.resource.resourceType}` : " · Direct chats"}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  loading={revokingId() === approval.id}
                  loadingLabel="Revoking"
                  disabled={Boolean(revokingId())}
                  onClick={() => void revoke(approval)}
                >
                  Revoke
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

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
          <pre class="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-50 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-700 [box-shadow:var(--ui-control-recess)] dark:bg-zinc-900 dark:text-zinc-300">
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
    <div class="dialog-fixed-frame flex min-h-0 flex-col overflow-hidden">
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
              onValueChange={setInstructions}
              markdown
              lines={9}
              maxLength={INSTRUCTIONS_MAX_CHARS}
              placeholder={"I study computer science and prefer short, technical answers.\nAlways answer in German."}
              disabled={busy()}
            />
            <SystemPromptDisclosure />
            <div class="flex justify-end pt-2">
              <Button
                type="submit"
                size="sm"
                loading={saveInstructions.loading()}
                loadingLabel="Saving instructions"
                disabled={busy() || !instructionsDirty()}
              >
                <i class="ti ti-device-floppy" aria-hidden="true" />
                Save instructions
              </Button>
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
              onValueChange={setMemoryEnabled}
              disabled={busy()}
            />
            <TextInput
              label="Memories"
              description="One memory per line, stamped with the date it was saved. The assistant reads this list in every chat and can add or remove entries."
              value={memory}
              onValueChange={setMemory}
              markdown
              lines={9}
              maxLength={MEMORY_MAX_CHARS}
              placeholder={"Studies computer science at Uni Ulm.\nPrefers answers in German."}
              disabled={busy()}
            />
            <div class="flex justify-end pt-2">
              <Button
                type="submit"
                size="sm"
                loading={saveMemory.loading()}
                loadingLabel="Saving memory"
                disabled={busy() || !memoryDirty()}
              >
                <i class="ti ti-device-floppy" aria-hidden="true" />
                Save memory
              </Button>
            </div>
          </form>
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="approvals"
          title="Approvals"
          icon="ti ti-shield-check"
          description="Manage actions Assistant may run without asking each time."
        >
          <ApprovalPreferences />
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
