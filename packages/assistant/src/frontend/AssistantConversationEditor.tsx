import type { AiConversation, AiEnrichmentRun, AiEnrichmentStatus } from "@valentinkolb/cloud/ai";
import { CheckboxCard, DataTable, type DataTableColumn, IconInput, prompts, SettingsModal, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { assistantApi } from "../api/client";

type EditConversationResult = { action: "save"; conversation: AiConversation } | { action: "archive"; conversation: AiConversation };

type EditConversationFormProps = {
  conversation: AiConversation;
  archiveDisabled?: boolean;
  archiveDisabledReason?: string;
  close: (result?: EditConversationResult) => void;
};

type EditConversationOptions = Pick<EditConversationFormProps, "archiveDisabled" | "archiveDisabledReason">;

const DEFAULT_CHAT_ICON = "ti ti-message";

export const conversationIcon = (conversation: AiConversation): string => conversation.icon?.trim() || DEFAULT_CHAT_ICON;

const RUN_STATUS_BADGES: Record<AiEnrichmentRun["status"], { label: string; class: string }> = {
  ok: { label: "ok", class: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  failed: { label: "failed", class: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  skipped: { label: "skipped", class: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
};

const formatRunTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const formatRunDuration = (durationMs: number | null): string => {
  if (durationMs === null) return "–";
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${durationMs}ms`;
};

/**
 * User-visible search-index state of one chat: last runs of the enrichment
 * job (summary/keywords/title for search) plus a manual reindex trigger.
 */
function SearchIndexSection(props: { conversationId: string }) {
  const [status, setStatus] = createSignal<AiEnrichmentStatus | null>(null);
  const [runs, setRuns] = createSignal<AiEnrichmentRun[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  // Set while a manual reindex is queued/running; cleared when its run shows up.
  const [queuedAt, setQueuedAt] = createSignal<number | null>(null);

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
  };
  onCleanup(stopPolling);

  const load = mutation.create<{ status: AiEnrichmentStatus | null; runs: AiEnrichmentRun[] }, void>({
    mutation: async () => assistantApi.getEnrichment(props.conversationId),
    onSuccess: (result) => {
      setStatus(result.status);
      setRuns(result.runs);
      setLoaded(true);
      // The queued reindex is done once a run newer than the click appears.
      const queued = queuedAt();
      if (queued && result.runs.some((run) => Date.parse(run.createdAt) >= queued)) {
        setQueuedAt(null);
        stopPolling();
      }
    },
    onError: (error) => prompts.error(error.message),
  });

  const reindex = mutation.create<void, void>({
    // Toasts render below the native <dialog> top layer, so feedback lives
    // inline: queued state in the status line + polling until the run appears.
    mutation: async () => assistantApi.reindexConversation(props.conversationId),
    onSuccess: () => {
      setQueuedAt(Date.now() - 1_000);
      stopPolling();
      pollTimer = setInterval(() => {
        if (!queuedAt()) return stopPolling();
        // Give up polling after 3 minutes; the table still updates on reopen.
        if (Date.now() - (queuedAt() ?? 0) > 180_000) {
          setQueuedAt(null);
          return stopPolling();
        }
        void load.mutate(undefined);
      }, 5_000);
      void load.mutate(undefined);
    },
    onError: (error) => prompts.error(error.message),
  });

  onMount(() => void load.mutate(undefined));

  const columns: DataTableColumn<AiEnrichmentRun>[] = [
    { id: "when", header: "When", value: (run) => formatRunTime(run.createdAt) },
    { id: "status", header: "Status", value: "status" },
    { id: "trigger", header: "Trigger", value: "trigger" },
    { id: "model", header: "Model", value: (run) => run.modelProfileId ?? "–" },
    { id: "duration", header: "Duration", value: (run) => formatRunDuration(run.durationMs), cellClass: "tabular-nums" },
    {
      id: "result",
      header: "Result",
      value: (run) =>
        run.status === "failed" ? (run.error ?? "failed") : `${run.keywordsCount} keywords${run.titleUpdated ? " · title updated" : ""}`,
    },
  ];

  const statusLine = () => {
    if (queuedAt()) return "Reindex queued — running in the background…";
    const current = status();
    if (!current) return "Index state unavailable.";
    if (!current.enrichedAt) return "Not indexed yet — the next background run will pick this chat up.";
    const indexed = `Last indexed ${formatRunTime(current.enrichedAt)}`;
    return current.dirty ? `${indexed} · changes pending` : `${indexed} · up to date`;
  };

  const busy = () => reindex.loading() || Boolean(queuedAt());

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-2">
        <p class={`min-w-0 truncate text-xs ${queuedAt() ? "text-primary" : "text-dimmed"}`}>
          <Show when={queuedAt()}>
            <i class="ti ti-loader-2 mr-1 inline-block animate-spin" aria-hidden="true" />
          </Show>
          {statusLine()}
        </p>
        <button type="button" class="btn-input btn-input-sm shrink-0" disabled={busy()} onClick={() => reindex.mutate(undefined)}>
          <i class={busy() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} />
          {queuedAt() ? "Queued" : "Reindex"}
        </button>
      </div>

      <Show when={(status()?.keywords.length ?? 0) > 0}>
        <div class="flex flex-wrap gap-1">
          {(status()?.keywords ?? []).map((keyword) => (
            <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{keyword}</span>
          ))}
        </div>
      </Show>

      <Show when={loaded()}>
        <DataTable
          rows={runs()}
          columns={columns}
          getRowId={(run) => run.id}
          density="compact"
          class="max-h-48 overflow-auto rounded-md"
          empty={<p class="px-3 py-4 text-xs text-dimmed">No index runs yet.</p>}
          renderCell={({ row, col, value, render }) => {
            if (col.id === "status") {
              const badge = RUN_STATUS_BADGES[row.status];
              return <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.class}`}>{badge.label}</span>;
            }
            return render(value);
          }}
        />
      </Show>
    </div>
  );
}

function EditConversationForm(props: EditConversationFormProps) {
  const [title, setTitle] = createSignal(props.conversation.title);
  const [icon, setIcon] = createSignal(conversationIcon(props.conversation));
  const [description, setDescription] = createSignal(props.conversation.description);
  const [pinned, setPinned] = createSignal(Boolean(props.conversation.pinnedAt));

  const save = mutation.create<AiConversation, void>({
    mutation: async () =>
      assistantApi.updateConversation(props.conversation.id, {
        title: title().trim(),
        icon: icon().trim() || DEFAULT_CHAT_ICON,
        description: description().trim(),
        pinned: pinned(),
      }),
    onSuccess: (conversation) => {
      toast.success("Chat saved");
      props.close({ action: "save", conversation });
    },
    onError: (error) => prompts.error(error.message),
  });

  const archive = mutation.create<boolean, void>({
    mutation: async () => {
      if (props.archiveDisabled) return false;
      const confirmed = await prompts.confirm(`Archive "${props.conversation.title}"?`, {
        title: "Archive chat",
        icon: "ti ti-archive",
        confirmText: "Archive",
        cancelText: "Cancel",
      });
      if (!confirmed) return false;

      await assistantApi.archiveConversation(props.conversation.id);
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Chat archived");
      props.close({ action: "archive", conversation: props.conversation });
    },
    onError: (error) => prompts.error(error.message),
  });
  const busy = () => save.loading() || archive.loading();

  return (
    <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
      <SettingsModal title="Chat settings" onClose={() => props.close()} closeLabel="Close chat settings">
        <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Name, icon, description, and list placement.">
          <form
            class="flex flex-col gap-4"
            aria-busy={busy()}
            onSubmit={(event) => {
              event.preventDefault();
              void save.mutate(undefined);
            }}
          >
            <IconInput label="Icon" value={icon} onChange={setIcon} required clearable={false} disabled={busy()} />
            <TextInput label="Name" value={title} onInput={setTitle} required maxLength={120} disabled={busy()} />
            <TextInput
              label="Description"
              value={description}
              onInput={setDescription}
              multiline
              lines={3}
              maxLength={500}
              placeholder="Optional context for this chat..."
              disabled={busy()}
            />
            <CheckboxCard
              label="Pin this chat"
              description="Keep this chat at the top of your chat list."
              icon="ti ti-pin"
              value={pinned}
              onChange={setPinned}
              disabled={busy()}
            />
            <div class="flex justify-end pt-2">
              <button type="submit" class="btn-primary btn-sm" disabled={busy() || !title().trim()}>
                <i class={save.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} />
                Save changes
              </button>
            </div>
          </form>
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="search"
          title="Search"
          icon="ti ti-list-search"
          description="Review and refresh the generated summary and keywords used to find this chat."
        >
          <SearchIndexSection conversationId={props.conversation.id} />
        </SettingsModal.Tab>

        <SettingsModal.Tab
          id="archive"
          title="Archive"
          icon="ti ti-archive"
          description="Remove this chat from your active lists. You can restore it later from All Chats."
        >
          <div class="flex max-w-xl flex-col items-start gap-3">
            <button
              type="button"
              class="btn-secondary btn-sm shrink-0"
              disabled={busy() || props.archiveDisabled}
              title={props.archiveDisabledReason}
              onClick={() => archive.mutate(undefined)}
            >
              <i class={archive.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-archive"} />
              Archive chat
            </button>
            <Show when={props.archiveDisabledReason}>{(reason) => <p class="text-xs leading-5 text-dimmed">{reason()}</p>}</Show>
          </div>
        </SettingsModal.Tab>
      </SettingsModal>
    </div>
  );
}

export const openAssistantConversationEditor = (
  conversation: AiConversation,
  options: EditConversationOptions = {},
): Promise<EditConversationResult | undefined> =>
  prompts.dialog<EditConversationResult | undefined>(
    (close) => <EditConversationForm conversation={conversation} close={close} {...options} />,
    {
      surface: "bare",
      header: false,
      size: "large",
    },
  );
