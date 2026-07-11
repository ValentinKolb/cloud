import type { AiConversation, AiEnrichmentRun, AiEnrichmentStatus } from "@valentinkolb/cloud/ai";
import {
  DataTable,
  type DataTableColumn,
  dialogCore,
  IconInput,
  PanelDialog,
  panelDialogOptions,
  prompts,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { assistantApi } from "../api/client";

type EditConversationResult = { action: "save"; conversation: AiConversation } | { action: "delete"; conversation: AiConversation };

type EditConversationFormProps = {
  conversation: AiConversation;
  close: (result?: EditConversationResult) => void;
};

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
    <PanelDialog.Section
      title="Search index"
      subtitle="Summary, keywords, and title are generated in the background so this chat is findable in search."
      icon="ti ti-list-search"
    >
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
    </PanelDialog.Section>
  );
}

function EditConversationForm(props: EditConversationFormProps) {
  const [title, setTitle] = createSignal(props.conversation.title);
  const [icon, setIcon] = createSignal(conversationIcon(props.conversation));
  const [description, setDescription] = createSignal(props.conversation.description);

  const save = mutation.create<AiConversation, void>({
    mutation: async () =>
      assistantApi.updateConversation(props.conversation.id, {
        title: title().trim(),
        icon: icon().trim() || DEFAULT_CHAT_ICON,
        description: description().trim(),
      }),
    onSuccess: (conversation) => {
      toast.success("Chat saved");
      props.close({ action: "save", conversation });
    },
    onError: (error) => prompts.error(error.message),
  });

  const remove = mutation.create<boolean, void>({
    mutation: async () => {
      const confirmed = await prompts.confirm(`Delete "${props.conversation.title}"?`, {
        title: "Delete chat",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
        cancelText: "Cancel",
      });
      if (!confirmed) return false;

      await assistantApi.deleteConversation(props.conversation.id);
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Chat deleted");
      props.close({ action: "delete", conversation: props.conversation });
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save.mutate(undefined);
        }}
      >
        <PanelDialog.Header title="Edit chat" icon="ti ti-settings" close={() => props.close()} />
        <PanelDialog.Body>
          <IconInput label="Icon" value={icon} onChange={setIcon} required clearable={false} />
          <TextInput label="Name" value={title} onInput={setTitle} required maxLength={120} />
          <TextInput
            label="Description"
            value={description}
            onInput={setDescription}
            multiline
            lines={3}
            maxLength={500}
            placeholder="Optional context for this chat..."
          />
          <SearchIndexSection conversationId={props.conversation.id} />
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <button
            type="button"
            class="btn-danger btn-sm"
            disabled={remove.loading() || save.loading()}
            onClick={() => remove.mutate(undefined)}
          >
            <i class={remove.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} />
            Delete
          </button>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-secondary btn-sm" disabled={save.loading() || remove.loading()} onClick={() => props.close()}>
              Cancel
            </button>
            <button type="submit" class="btn-primary btn-sm" disabled={save.loading() || remove.loading() || !title().trim()}>
              <i class={save.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} />
              Save
            </button>
          </div>
        </PanelDialog.Footer>
      </form>
    </PanelDialog>
  );
}

export const openAssistantConversationEditor = (conversation: AiConversation): Promise<EditConversationResult | undefined> =>
  dialogCore.open<EditConversationResult | undefined>(
    (close) => <EditConversationForm conversation={conversation} close={close} />,
    panelDialogOptions,
  );
