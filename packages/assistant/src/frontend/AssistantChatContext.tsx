import { Button, IconButton, Placeholder, prompts } from "@k2b/ui";
import type { AiConversationSource, AiFileStat } from "@valentinkolb/cloud/ai";
import { createResource, For, onCleanup, onMount, Show } from "solid-js";
import { assistantApi } from "../api/client";
import type { AssistantChatTask } from "../chat-tasks-contracts";
import { openAssistantFilesDialog } from "./AssistantArtifactDetail";
import { openAssistantTasksDialog } from "./AssistantTasksDialog";

type Snapshot = { sources: AiConversationSource[]; files: AiFileStat[]; tasks: AssistantChatTask[] };

const readJson = async <T,>(response: Response, fallback: string): Promise<T> => {
  if (!response.ok) throw new Error(fallback);
  return response.json() as Promise<T>;
};

const loadSnapshot = async (chatId: string): Promise<Snapshot> => {
  const [sourcePage, files, tasks] = await Promise.all([
    assistantApi.listConversationSources({ conversationId: chatId, limit: 6 }),
    fetch(`/api/assistant/conversations/${encodeURIComponent(chatId)}/files`).then((response) =>
      readJson<{ files: AiFileStat[] }>(response, "Failed to load chat files"),
    ),
    fetch(`/api/assistant/tasks?chatId=${encodeURIComponent(chatId)}&limit=100`).then((response) =>
      readJson<AssistantChatTask[]>(response, "Failed to load scheduled tasks"),
    ),
  ]);
  return { sources: sourcePage.sources, files: files.files, tasks: tasks.filter((task) => task.state !== "completed") };
};

function SourceList(props: { sources: AiConversationSource[] }) {
  return (
    <ul class="flex flex-col gap-2">
      <For each={props.sources}>
        {(source) => (
          <li class="flex min-w-0 items-start gap-2">
            <i class={`${source.icon} mt-0.5 text-secondary`} aria-hidden="true" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-primary">{source.title}</span>
              <Show when={source.preview}>
                <span class="block truncate text-xs text-dimmed">{source.preview}</span>
              </Show>
            </span>
            <Show when={source.occurrences > 1}>
              <span class="text-xs text-dimmed">×{source.occurrences}</span>
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}

export function AssistantSourcesView(props: { chatId: string; onClose?: () => void }) {
  const [page] = createResource(
    () => props.chatId,
    (chatId) => assistantApi.listConversationSources({ conversationId: chatId, limit: 100 }),
  );
  return (
    <div class="flex min-h-72 flex-col gap-4 overflow-auto">
      <Show when={props.onClose}>
        <header class="flex items-center gap-2">
          <i class="ti ti-affiliate" aria-hidden="true" />
          <h2 class="flex-1 font-semibold text-primary">Sources</h2>
          <IconButton label="Close Sources" variant="ghost" onClick={props.onClose}>
            <i class="ti ti-x" />
          </IconButton>
        </header>
      </Show>
      <Show
        when={page()}
        fallback={
          <Placeholder state={page.error ? "error" : "loading"} title={page.error ? "Could not load Sources" : "Loading Sources"} />
        }
      >
        <SourceList sources={page()!.sources} />
      </Show>
    </div>
  );
}

export const openAssistantSourcesDialog = (chatId: string) =>
  prompts.dialog<void>(() => <AssistantSourcesView chatId={chatId} />, {
    title: "Sources",
    icon: "ti ti-affiliate",
    size: "large",
  });

export function AssistantChatContextPanel(props: { chatId: string; onClose: () => void; floating?: boolean; onViewSources?: () => void }) {
  const [snapshot] = createResource(() => props.chatId, loadSnapshot);
  let panel: HTMLElement | undefined;
  onMount(() => {
    if (props.floating === false) return;
    const closeOutside = (event: PointerEvent) => {
      if (panel && !panel.contains(event.target as Node)) props.onClose();
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    onCleanup(() => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    });
  });
  return (
    <aside
      ref={panel}
      class={
        props.floating === false
          ? "flex flex-col gap-5"
          : "absolute right-4 top-4 z-30 hidden max-h-[calc(100%-2rem)] w-80 overflow-auto rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 shadow-xl lg:flex lg:flex-col lg:gap-5"
      }
      aria-label="Chat context"
    >
      <Show when={props.floating !== false}>
        <header class="flex items-center gap-2">
          <i class="ti ti-adjustments-horizontal" aria-hidden="true" />
          <h2 class="flex-1 font-semibold text-primary">Chat context</h2>
          <IconButton variant="ghost" size="sm" label="Close chat context" onClick={props.onClose}>
            <i class="ti ti-x" />
          </IconButton>
        </header>
      </Show>
      <Show
        when={snapshot()}
        fallback={
          <Placeholder state={snapshot.error ? "error" : "loading"} title={snapshot.error ? "Could not load context" : "Loading context"} />
        }
      >
        {(value) => (
          <>
            <section class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-primary">Sources</h3>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => (props.onViewSources ? props.onViewSources() : void openAssistantSourcesDialog(props.chatId))}
                >
                  View all
                </Button>
              </div>
              <Show when={value().sources.length} fallback={<p class="text-xs text-dimmed">No Sources yet.</p>}>
                <SourceList sources={value().sources.slice(0, 3)} />
              </Show>
            </section>
            <section>
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-primary">
                  Files <span class="font-normal text-dimmed">{value().files.length}</span>
                </h3>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void openAssistantFilesDialog({ conversationId: props.chatId, refreshKey: () => props.chatId })}
                >
                  View all
                </Button>
              </div>
              <p class="mt-1 truncate text-xs text-dimmed">{value().files[0]?.path ?? "No files yet."}</p>
            </section>
            <section>
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-primary">
                  Scheduled <span class="font-normal text-dimmed">{value().tasks.length}</span>
                </h3>
                <Button size="xs" variant="ghost" onClick={() => void openAssistantTasksDialog(props.chatId)}>
                  View all
                </Button>
              </div>
              <Show when={value().tasks[0]} fallback={<p class="mt-1 text-xs text-dimmed">Nothing scheduled.</p>}>
                {(task) => <p class="mt-1 line-clamp-2 text-xs text-secondary">{task().prompt}</p>}
              </Show>
            </section>
            <footer class="flex items-center justify-between text-xs text-dimmed">
              <span>Chat ID</span>
              <code>{props.chatId}</code>
            </footer>
          </>
        )}
      </Show>
    </aside>
  );
}

export const openAssistantChatContextDialog = (chatId: string) =>
  prompts.dialog<void>((close) => <AssistantChatContextPanel chatId={chatId} onClose={() => close()} floating={false} />, {
    title: "Chat context",
    icon: "ti ti-adjustments-horizontal",
    size: "medium",
  });
