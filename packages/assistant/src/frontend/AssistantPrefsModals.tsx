import { Link } from "@k2b/ssr/nav";
import { Button, Placeholder, prompts, Select, SettingsModal, Switch, TextInput, toast } from "@k2b/ui";
import type { AiApprovalPreferenceView, AiMemory, AiMemoryKind, AiUserPrefs } from "@valentinkolb/cloud/ai";
import { coreClient } from "@valentinkolb/cloud/clients/core";
import { createResource, createSignal, For, Show } from "solid-js";
import { assistantApi } from "../api/client";
import { assistantConversationHref } from "./assistant-navigation";

// Kept in sync with the server limits; browser code does not import server-only constants.
const MEMORY_MAX_CHARS = 500;

type AssistantPrefsTab = "personalization" | "system-prompt" | "approvals";

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

function SystemPromptPanel() {
  const [prompt, { refetch }] = createResource(() => assistantApi.getSystemPromptPreview());
  return (
    <div class="flex flex-col gap-3">
      <p class="text-sm text-secondary">
        This is the complete prompt a new Assistant chat starts with right now, including active personalization and organization rules.
      </p>
      <Show when={prompt.loading}>
        <Placeholder state="loading" title="Loading system prompt" />
      </Show>
      <Show when={prompt.error}>
        <div class="flex flex-col items-center gap-2">
          <Placeholder state="error" title="Could not load system prompt" description={prompt.error.message} />
          <Button size="xs" variant="secondary" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      </Show>
      <Show when={prompt()?.prompt}>
        {(value) => (
          <pre class="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-700 [box-shadow:var(--ui-control-recess)] dark:bg-zinc-900 dark:text-zinc-300">
            {value()}
          </pre>
        )}
      </Show>
    </div>
  );
}

const openAddPersonalizationDialog = (): Promise<{ kind: AiMemoryKind; content: string } | undefined> =>
  prompts.dialog<{ kind: AiMemoryKind; content: string } | undefined>(
    (close) => {
      const [kind, setKind] = createSignal<AiMemoryKind>("fact");
      const [content, setContent] = createSignal("");
      return (
        <form
          class="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const value = content().trim();
            if (value) close({ kind: kind(), content: value });
          }}
        >
          <p class="text-sm text-secondary">Add a durable fact about you or a preference for future answers. New entries start pinned.</p>
          <Select
            label="Type"
            value={kind}
            onValueChange={(value) => setKind(value as AiMemoryKind)}
            options={[
              { value: "fact", label: "Fact" },
              { value: "preference", label: "Preference" },
            ]}
          />
          <TextInput
            label="Personalization"
            value={content}
            onValueChange={setContent}
            multiline
            lines={4}
            maxLength={MEMORY_MAX_CHARS}
            placeholder="Prefers concise answers in German."
            autofocus
          />
          <div class="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => close()}>
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={!content().trim()}>
              Add personalization
            </Button>
          </div>
        </form>
      );
    },
    { title: "Add personalization", icon: "ti ti-user-cog", size: "medium" },
  );

function MemorySettings(props: { prefs: AiUserPrefs }) {
  const [query, setQuery] = createSignal("");
  const [memories, { refetch }] = createResource(query, (q) => assistantApi.listMemories({ q: q.trim() || undefined, limit: 50 }));
  const [memoryEnabled, setMemoryEnabled] = createSignal(props.prefs.memoryEnabled);
  const [learningEnabled, setLearningEnabled] = createSignal(props.prefs.memoryLearningEnabled);
  const [busyId, setBusyId] = createSignal<string | null>(null);

  const saveSettings = async () => {
    setBusyId("settings");
    try {
      await assistantApi.updatePrefs({ memoryEnabled: memoryEnabled(), memoryLearningEnabled: learningEnabled() });
      toast.success("Personalization settings saved");
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Failed to save personalization settings");
    } finally {
      setBusyId(null);
    }
  };

  const addMemory = async () => {
    if (busyId()) return;
    const value = await openAddPersonalizationDialog();
    if (!value || busyId()) return;
    setBusyId("new");
    try {
      await assistantApi.createMemory({ ...value, priority: "pinned" });
      await refetch();
      toast.success("Personalization added");
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Failed to add personalization");
    } finally {
      setBusyId(null);
    }
  };

  const editMemory = async (memory: AiMemory) => {
    const value = await prompts.prompt("Edit this personalization entry.", memory.content, { title: "Edit personalization" });
    if (value === null || value.trim() === memory.content || !value.trim()) return;
    setBusyId(memory.id);
    try {
      await assistantApi.updateMemory(memory.id, { content: value.trim() });
      await refetch();
      toast.success("Personalization updated");
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Failed to update personalization");
    } finally {
      setBusyId(null);
    }
  };

  const togglePinned = async (memory: AiMemory) => {
    setBusyId(memory.id);
    try {
      await assistantApi.updateMemory(memory.id, { priority: memory.priority === "pinned" ? "normal" : "pinned" });
      await refetch();
      toast.success(memory.priority === "pinned" ? "Personalization unpinned" : "Personalization pinned");
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Failed to update personalization");
    } finally {
      setBusyId(null);
    }
  };

  const removeMemory = async (memory: AiMemory) => {
    if (!(await prompts.confirm(`Forget "${memory.content}"?`, { title: "Forget personalization", variant: "danger" }))) return;
    setBusyId(memory.id);
    try {
      await assistantApi.deleteMemory(memory.id);
      await refetch();
      toast.success("Personalization forgotten");
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Failed to delete personalization");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div class="flex flex-col gap-5" aria-busy={Boolean(busyId()) || memories.loading}>
      <div class="flex flex-col gap-3">
        <Switch
          label="Use personalization in Assistant chats"
          description="Relevant personal facts and preferences are added to the context of new turns."
          value={memoryEnabled}
          onValueChange={setMemoryEnabled}
          disabled={Boolean(busyId())}
        />
        <Switch
          label="Learn personalization from private chats"
          description="After a chat becomes idle, Assistant may save durable facts and preferences with a link to that chat."
          value={learningEnabled}
          onValueChange={setLearningEnabled}
          disabled={Boolean(busyId())}
        />
        <div class="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            loading={busyId() === "settings"}
            loadingLabel="Saving settings"
            onClick={() => void saveSettings()}
          >
            Save settings
          </Button>
        </div>
      </div>

      <div class="flex items-end gap-2">
        <div class="min-w-0 flex-1">
          <TextInput
            label="Search personalization"
            value={query}
            onValueChange={setQuery}
            placeholder="Search facts and preferences"
            disabled={Boolean(busyId())}
          />
        </div>
        <Button variant="secondary" loading={busyId() === "new"} disabled={Boolean(busyId())} onClick={() => void addMemory()}>
          + Add
        </Button>
      </div>

      <Show when={memories.loading}>
        <Placeholder state="loading" title="Loading memories" />
      </Show>
      <Show when={memories.error}>
        <div class="flex flex-col items-center gap-2">
          <Placeholder state="error" title="Could not load personalization" description={memories.error.message} />
          <Button size="xs" variant="secondary" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      </Show>
      <Show when={!memories.loading && !memories.error && (memories()?.length ?? 0) === 0}>
        <Placeholder
          title={query().trim() ? "No matching personalization" : "No personalization yet"}
          description={
            query().trim() ? "Try a different search." : "Add a durable fact or preference, or enable learning from private chats."
          }
        />
      </Show>
      <Show when={!memories.error && (memories()?.length ?? 0) > 0}>
        <ul class="flex flex-col gap-3">
          <For each={memories()}>
            {(memory) => (
              <li class="rounded-lg bg-muted p-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm text-primary">{memory.content}</p>
                    <p class="mt-1 text-xs text-secondary">
                      {memory.kind === "preference" ? "Preference" : "Fact"}
                      {memory.priority === "pinned" ? " · Pinned" : ""} · Updated {new Date(memory.updatedAt).toLocaleDateString()}
                      <Show when={memory.sourceConversationId}>
                        {(conversationId) => (
                          <>
                            {" · "}
                            <Link href={assistantConversationHref(globalThis.location?.href ?? "/app/assistant", conversationId())}>
                              Source chat
                            </Link>
                          </>
                        )}
                      </Show>
                    </p>
                  </div>
                  <div class="flex shrink-0 flex-wrap justify-end gap-1">
                    <Button size="xs" variant="ghost" disabled={Boolean(busyId())} onClick={() => void togglePinned(memory)}>
                      {memory.priority === "pinned" ? "Unpin" : "Pin"}
                    </Button>
                    <Button size="xs" variant="ghost" disabled={Boolean(busyId())} onClick={() => void editMemory(memory)}>
                      Edit
                    </Button>
                    <Button size="xs" variant="ghost" disabled={Boolean(busyId())} onClick={() => void removeMemory(memory)}>
                      Forget
                    </Button>
                  </div>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function PrefsDialog(props: { prefs: AiUserPrefs; initialTab: AssistantPrefsTab; close: () => void }) {
  const [activeTab, setActiveTab] = createSignal<AssistantPrefsTab>(props.initialTab);
  return (
    <div class="dialog-fixed-frame flex min-h-0 flex-col overflow-hidden">
      <SettingsModal
        title="Assistant settings"
        activeTab={activeTab()}
        onTabChange={(tab) => setActiveTab(tab as AssistantPrefsTab)}
        onClose={props.close}
        closeLabel="Close Assistant settings"
      >
        <SettingsModal.Tab
          id="personalization"
          title="Personalization"
          icon="ti ti-user-cog"
          description="Manage the facts and preferences Assistant can carry into future conversations."
        >
          <MemorySettings prefs={props.prefs} />
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="system-prompt"
          title="System prompt"
          icon="ti ti-code"
          description="Inspect the complete instructions and context applied to new chats."
        >
          <Show when={activeTab() === "system-prompt"}>
            <SystemPromptPanel />
          </Show>
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
