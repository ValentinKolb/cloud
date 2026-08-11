import { Link } from "@k2b/ssr/nav";
import { Button, Placeholder, TextInput } from "@k2b/ui";
import type {
  AiConversation,
  AiConversationPage,
  AiProject,
  AiProjectFile,
  AiProjectKnowledge,
  AiProjectReference,
} from "@valentinkolb/cloud/ai";
import { coreClient } from "@valentinkolb/cloud/clients/core";
import { formatDateTime } from "@valentinkolb/cloud/shared";
import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { assistantApi } from "../api/client";
import { openAssistantProjectSettingsDialog } from "./AssistantProjectSettingsDialog";
import { assistantConversationHref, assistantProjectHref } from "./assistant-navigation";

type Props = {
  project: AiProject;
  initialQuery: string;
  initialPage: AiConversationPage;
  onNewChat: () => void | Promise<void>;
};

export default function AssistantProjectView(props: Props) {
  const [query, setQuery] = createSignal(props.initialQuery);
  const [page, setPage] = createSignal(props.initialPage);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [context] = createResource(
    () => props.project.id,
    async (projectId) => {
      const [knowledgeResponse, filesResponse, referencesResponse] = await Promise.all([
        coreClient.ai.projects[":projectId"].knowledge.$get({ param: { projectId }, query: {} }),
        coreClient.ai.projects[":projectId"].files.$get({ param: { projectId } }),
        coreClient.ai.projects[":projectId"].references.$get({ param: { projectId } }),
      ]);
      if (!knowledgeResponse.ok || !filesResponse.ok || !referencesResponse.ok) throw new Error("Failed to load Project context");
      return {
        knowledge: (await knowledgeResponse.json()).knowledge as AiProjectKnowledge[],
        files: (await filesResponse.json()).files as AiProjectFile[],
        references: (await referencesResponse.json()).references as AiProjectReference[],
      };
    },
  );
  let first = true;
  let loadMoreSentinel: HTMLDivElement | undefined;

  createEffect(() => {
    const value = query().trim();
    if (first) {
      first = false;
      return;
    }
    const timer = setTimeout(async () => {
      history.replaceState(null, "", assistantProjectHref(window.location.href, props.project.id, value));
      setLoading(true);
      setError(null);
      try {
        setPage(await assistantApi.listConversationsPage({ projectId: props.project.id, q: value || undefined, page: 1, perPage: 20 }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to search Project chats");
      } finally {
        setLoading(false);
      }
    }, 180);
    onCleanup(() => clearTimeout(timer));
  });

  const loadMore = async () => {
    const current = page();
    if (loading() || !current.hasNext) return;
    setLoading(true);
    try {
      const next = await assistantApi.listConversationsPage({
        projectId: props.project.id,
        q: query().trim() || undefined,
        page: current.page + 1,
        perPage: current.perPage,
      });
      setPage({ ...next, items: [...current.items, ...next.items] });
    } finally {
      setLoading(false);
    }
  };
  onMount(() => {
    if (!loadMoreSentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "240px" },
    );
    observer.observe(loadMoreSentinel);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div class="grid min-h-0 flex-1 gap-8 overflow-auto p-[var(--ui-space-section)] lg:grid-cols-[minmax(0,1fr)_22rem]">
      <main class="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <header class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-xs font-medium uppercase tracking-wide text-dimmed">Project</p>
            <h1 class="truncate text-2xl font-semibold text-primary">{props.project.name}</h1>
          </div>
          <Button onClick={() => void props.onNewChat()}>
            <i class="ti ti-message-plus" aria-hidden="true" />
            New chat
          </Button>
        </header>
        <section class="flex flex-col gap-3">
          <h2 class="text-sm font-semibold text-primary">{query().trim() ? "Search results" : "Recent chats"}</h2>
          <TextInput aria-label="Search Project chats" value={query} onValueChange={setQuery} placeholder="Search Project chats…" />
          <Show when={error()}>
            <Placeholder state="error" title="Could not load chats" description={error()!} />
          </Show>
          <div class="flex flex-col gap-1" aria-busy={loading()}>
            <For each={page().items}>
              {(chat: AiConversation) => (
                <Link
                  href={assistantConversationHref("/app/assistant", chat.id)}
                  class="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-[var(--ui-surface-subtle)] focus-visible:outline focus-visible:outline-2"
                >
                  <i class={`${chat.icon || "ti ti-message"} text-secondary`} aria-hidden="true" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium text-primary">{chat.title}</span>
                    <span class="block truncate text-xs text-dimmed">{chat.description || "Assistant chat"}</span>
                  </span>
                  <time class="text-xs text-dimmed">{formatDateTime(chat.updatedAt)}</time>
                </Link>
              )}
            </For>
          </div>
          <Show when={!error() && page().items.length === 0}>
            <Placeholder title={query().trim() ? "No matching chats" : "No Project chats yet"} />
          </Show>
          <div ref={loadMoreSentinel} class="flex min-h-8 items-center justify-center" aria-live="polite">
            <Show when={loading()}>
              <span class="text-xs text-dimmed">Loading more chats…</span>
            </Show>
          </div>
        </section>
      </main>
      <aside class="flex flex-col gap-6 rounded-xl bg-[var(--ui-surface-subtle)] p-5">
        <section>
          <h2 class="text-sm font-semibold text-primary">Instructions</h2>
          <p class="mt-2 whitespace-pre-wrap text-sm text-secondary">{props.project.instructions || "No Project instructions."}</p>
        </section>
        <Show
          when={context()}
          fallback={
            <Placeholder
              state={context.error ? "error" : "loading"}
              title={context.error ? "Could not load Project context" : "Loading Project context"}
            />
          }
        >
          {(value) => (
            <>
              <section>
                <h2 class="text-sm font-semibold text-primary">
                  Knowledge <span class="font-normal text-dimmed">{value().knowledge.length}</span>
                </h2>
                <ul class="mt-2 flex flex-col gap-1">
                  <For each={value().knowledge.slice(0, 5)}>{(item) => <li class="truncate text-sm text-secondary">{item.title}</li>}</For>
                </ul>
              </section>
              <section>
                <h2 class="text-sm font-semibold text-primary">
                  Files <span class="font-normal text-dimmed">{value().files.length}</span>
                </h2>
                <ul class="mt-2 flex flex-col gap-1">
                  <For each={value().files.slice(0, 5)}>{(item) => <li class="truncate text-sm text-secondary">{item.path}</li>}</For>
                </ul>
              </section>
              <section>
                <h2 class="text-sm font-semibold text-primary">
                  Cloud references <span class="font-normal text-dimmed">{value().references.length}</span>
                </h2>
                <ul class="mt-2 flex flex-col gap-1">
                  <For each={value().references.slice(0, 5)}>
                    {(item) => <li class="truncate text-sm text-secondary">{item.label || `${item.ref.type} · ${item.ref.id}`}</li>}
                  </For>
                </ul>
              </section>
            </>
          )}
        </Show>
        <Show when={props.project.permission !== "read"}>
          <Button variant="secondary" onClick={() => void openAssistantProjectSettingsDialog(props.project)}>
            Project settings
          </Button>
        </Show>
        <section>
          <h2 class="text-sm font-semibold text-primary">About</h2>
          <p class="mt-2 text-sm text-secondary">{props.project.description || "No description."}</p>
        </section>
        <p class="mt-auto text-xs text-dimmed">
          {props.project.permission} access · {props.project.id}
        </p>
      </aside>
    </div>
  );
}
