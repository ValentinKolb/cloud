import { query } from "@k2b/stdlib/solid";
import { Button, Lightbox, Placeholder, prompts, StatusBadge } from "@k2b/ui";
import type { AiConversationSource, AiProject } from "@valentinkolb/cloud/ai";
import { conversationFileSource } from "@valentinkolb/cloud/ai/solid";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { assistantApi } from "../api/client";
import type { AssistantChatContextSnapshot } from "../chat-context";
import type { AssistantChatTask } from "../chat-tasks-contracts";
import type { AssistantProjectContextSnapshot } from "../project-context";
import { AssistantChatContextSurface } from "./AssistantChatContextSurfaces";
import {
  AssistantContextEmpty,
  type AssistantContextFile,
  AssistantContextRow,
  AssistantContextRows,
  AssistantContextSection,
  assistantProjectFileSource,
  confirmOpenAssistantLink,
  isAssistantContextImage,
  loadAssistantContextImages,
  openAssistantCloudReference,
  openAssistantContextFiles,
  openAssistantKnowledgeSearch,
  openAssistantMarkdown,
} from "./AssistantContextContent";
import { AssistantTasksView, formatAssistantTaskSchedule } from "./AssistantTasksDialog";
import { assistantChatContextFor, splitAssistantConversationSources } from "./assistant-context";
import {
  type AssistantLiveHub,
  type AssistantLiveInvalidation,
  AssistantLiveProvider,
  matchesAssistantInvalidation,
  useAssistantLive,
} from "./assistant-live";

export { splitAssistantConversationSources } from "./assistant-context";

export const assistantChatContextHasContent = (snapshot: AssistantChatContextSnapshot): boolean =>
  snapshot.sources.some((source) => source.kind !== "file") ||
  snapshot.files.length > 0 ||
  snapshot.tasks.some((task) => task.state !== "completed");

const taskStatus = (task: AssistantChatTask) => {
  if (task.state === "active") return { label: task.schedule.kind === "once" ? "Pending" : "Active", tone: "ok" as const };
  if (task.state === "paused") return { label: "Paused", tone: "neutral" as const };
  return { label: "Needs attention", tone: "warning" as const };
};

const openSourceSearch = async (title: string, sources: readonly AiConversationSource[]) => {
  const selected = await prompts.search<AiConversationSource>(
    ({ query }) => {
      const normalized = query.trim().toLocaleLowerCase();
      return sources
        .filter((source) => !normalized || `${source.title} ${source.preview ?? ""}`.toLocaleLowerCase().includes(normalized))
        .map((source) => ({ value: source, label: source.title, desc: source.preview ?? undefined, icon: source.icon }));
    },
    { title, icon: "ti ti-search", placeholder: `Search ${title.toLocaleLowerCase()}…`, minQueryLength: 0, size: "small" },
  );
  if (selected?.value?.href) await confirmOpenAssistantLink(selected.value.title, selected.value.href);
};

type AssistantChatContextQueryProps = {
  chatId: string;
  project?: AiProject | null;
  initial?: AssistantChatContextSnapshot | null;
};

const createAssistantChatContextState = (props: AssistantChatContextQueryProps) => {
  const live = useAssistantLive();
  const snapshot = query.create<string, AssistantChatContextSnapshot, AssistantLiveInvalidation>({
    source: () => props.chatId,
    initial: props.initial ? { source: props.initial.chatId, data: props.initial } : undefined,
    load: (chatId, { abortSignal }) => assistantApi.loadChatContext(chatId, abortSignal),
  });
  const projectSnapshot = query.create<string | null, AssistantProjectContextSnapshot | null, AssistantLiveInvalidation>({
    source: () => props.project?.id ?? null,
    load: (projectId, { abortSignal }) => {
      if (!projectId) return Promise.resolve(null);
      return assistantApi.loadProjectContext(projectId, abortSignal);
    },
  });
  const unregisterChat = live.register({
    matches: (invalidation) =>
      matchesAssistantInvalidation(["conversation-sources", "conversation-files", "conversation-tasks", "conversation-detail"])(
        invalidation,
      ) &&
      (!invalidation.conversationIds || invalidation.conversationIds.has(props.chatId)),
    invalidate: (invalidation) => snapshot.invalidate(invalidation),
  });
  const unregisterProject = live.register({
    matches: (invalidation) =>
      Boolean(props.project?.id) &&
      matchesAssistantInvalidation(["project-detail", "project-context"], { projectId: props.project!.id })(invalidation),
    invalidate: (invalidation) => projectSnapshot.invalidate(invalidation),
  });
  onCleanup(() => {
    unregisterChat();
    unregisterProject();
  });
  const value = () => assistantChatContextFor(props.chatId, snapshot.data());
  const context = () => {
    const chat = value();
    if (!chat || (props.project && !projectSnapshot.data())) return null;
    const sources = splitAssistantConversationSources(chat.sources);
    return {
      chat: { ...chat, ...sources, tasks: chat.tasks.filter((task) => task.state !== "completed") },
      project: props.project ?? null,
      projectContext: projectSnapshot.data() ?? null,
    };
  };
  return {
    snapshot: value,
    context,
    error: () => snapshot.error() ?? projectSnapshot.error(),
    refresh: async () => {
      await Promise.all([snapshot.refresh(), props.project ? projectSnapshot.refresh() : Promise.resolve()]);
    },
    presence: () => {
      const chat = value();
      if (!chat) return null;
      if (assistantChatContextHasContent(chat) || props.project?.instructions) return true;
      const project = projectSnapshot.data();
      return props.project && !project
        ? null
        : Boolean(project && (project.knowledge.length || project.files.length || project.references.length));
    },
  };
};

type AssistantChatContextState = ReturnType<typeof createAssistantChatContextState>;

function AssistantChatContextView(props: { state: AssistantChatContextState }) {
  const [lightbox, setLightbox] = createSignal<{ images: Awaited<ReturnType<typeof loadAssistantContextImages>>; index: number } | null>(
    null,
  );
  return (
    <Show
      when={props.state.context()}
      fallback={
        <Placeholder
          state={props.state.error() ? "error" : "loading"}
          title={props.state.error() ? "Could not load context" : "Loading context"}
          description={props.state.error()?.message}
          action={
            props.state.error() ? (
              <Button size="sm" variant="secondary" onClick={() => void props.state.refresh()}>
                Retry
              </Button>
            ) : undefined
          }
        />
      }
    >
      {(value) => {
        const chatSource = conversationFileSource("/api/assistant", value().chat.chatId);
        const projectSource = value().project
          ? assistantProjectFileSource(value().project!.id, () => value().projectContext?.files ?? [])
          : null;
        const files = (): AssistantContextFile[] => [
          ...value().chat.files.map((file) => ({
            id: `chat:${file.path}`,
            path: file.path,
            mediaType: file.mediaType,
            size: file.size,
            scope: "chat" as const,
            source: chatSource,
          })),
          ...(value().projectContext?.files ?? []).map((file) => ({
            id: `project:${file.id}`,
            path: file.path,
            mediaType: file.mediaType,
            size: file.size,
            scope: "project" as const,
            source: projectSource!,
          })),
        ];
        const images = () => files().filter(isAssistantContextImage);
        const regularFiles = () => files().filter((file) => !isAssistantContextImage(file));
        const hasMixedScope = (items: readonly AssistantContextFile[]) =>
          items.some((file) => file.scope === "chat") && items.some((file) => file.scope === "project");
        const openImages = async (selected?: AssistantContextFile) => {
          try {
            const loaded = await loadAssistantContextImages(files());
            const index = selected
              ? Math.max(
                  0,
                  loaded.findIndex((entry) => entry.file.id === selected.id),
                )
              : 0;
            setLightbox({ images: loaded, index });
          } catch (error) {
            void prompts.error(error instanceof Error ? error.message : "Images could not be loaded.", { title: "Could not open images" });
          }
        };
        const openReferences = async () => {
          const references = [
            ...value().chat.references.map((source) => ({
              kind: "source" as const,
              title: source.title,
              description: source.preview ?? undefined,
              icon: source.icon,
              source,
            })),
            ...(value().projectContext?.references ?? []).map((reference) => ({
              kind: "project" as const,
              title: reference.label || `${reference.ref.type} · ${reference.ref.id}`,
              description: "Project",
              icon: "ti ti-link",
              reference,
            })),
          ];
          const selected = await prompts.search<(typeof references)[number]>(
            ({ query }) => {
              const normalized = query.trim().toLocaleLowerCase();
              return references
                .filter(
                  (reference) =>
                    !normalized || `${reference.title} ${reference.description ?? ""}`.toLocaleLowerCase().includes(normalized),
                )
                .map((reference) => ({
                  value: reference,
                  label: reference.title,
                  desc: reference.description,
                  icon: reference.icon,
                }));
            },
            { title: "References", icon: "ti ti-link", placeholder: "Search references…", minQueryLength: 0, size: "small" },
          );
          if (!selected?.value) return;
          if (selected.value.kind === "source" && selected.value.source.href) {
            await confirmOpenAssistantLink(selected.value.title, selected.value.source.href);
          } else if (selected.value.kind === "project") {
            await openAssistantCloudReference(selected.value.title, selected.value.reference.ref);
          }
        };
        return (
          <div class="flex flex-col gap-5">
            <Show when={value().project}>
              {(project) => (
                <AssistantContextSection title={project().name}>
                  <AssistantContextRow
                    title="View project"
                    onClick={() =>
                      void openAssistantMarkdown(
                        "Project instructions",
                        project().instructions || "No Project instructions yet.",
                        "ti ti-adjustments-horizontal",
                      )
                    }
                  />
                </AssistantContextSection>
              )}
            </Show>

            <Show when={value().projectContext}>
              {(project) => (
                <AssistantContextSection
                  title="Project knowledge"
                  count={project().knowledge.length}
                  onViewAll={() => void openAssistantKnowledgeSearch(project().knowledge)}
                >
                  <Show when={project().knowledge[0]} fallback={<AssistantContextEmpty>No Project knowledge yet.</AssistantContextEmpty>}>
                    {(item) => (
                      <AssistantContextRow
                        icon="ti ti-bulb"
                        title={item().title}
                        onClick={() => void openAssistantMarkdown(item().title, item().content, "ti ti-bulb")}
                      />
                    )}
                  </Show>
                </AssistantContextSection>
              )}
            </Show>

            <AssistantContextSection
              title="Sources"
              count={value().chat.sources.length}
              onViewAll={() => void openSourceSearch("Sources", value().chat.sources)}
            >
              <Show when={value().chat.sources.length > 0} fallback={<AssistantContextEmpty>No sources used yet.</AssistantContextEmpty>}>
                <AssistantContextRows>
                  <For each={value().chat.sources.slice(0, 3)}>
                    {(source) => (
                      <AssistantContextRow
                        icon={source.icon}
                        title={source.title}
                        description={source.preview ?? undefined}
                        onClick={source.href ? () => void confirmOpenAssistantLink(source.title, source.href!) : undefined}
                      />
                    )}
                  </For>
                </AssistantContextRows>
              </Show>
            </AssistantContextSection>

            <AssistantContextSection
              title="References"
              count={value().chat.references.length + (value().projectContext?.references.length ?? 0)}
              onViewAll={() => void openReferences()}
            >
              <AssistantContextRows>
                <For each={value().chat.references.slice(0, 2)}>
                  {(source) => (
                    <AssistantContextRow
                      icon={source.icon}
                      title={source.title}
                      description={source.preview ?? undefined}
                      onClick={source.href ? () => void confirmOpenAssistantLink(source.title, source.href!) : undefined}
                    />
                  )}
                </For>
                <For each={(value().projectContext?.references ?? []).slice(0, 2)}>
                  {(reference) => {
                    const title = reference.label || `${reference.ref.type} · ${reference.ref.id}`;
                    return (
                      <AssistantContextRow
                        icon="ti ti-link"
                        title={title}
                        scope="project"
                        showScope={value().chat.references.length > 0}
                        onClick={() => void openAssistantCloudReference(title, reference.ref)}
                      />
                    );
                  }}
                </For>
                <Show when={value().chat.references.length + (value().projectContext?.references.length ?? 0) === 0}>
                  <AssistantContextEmpty>No references used yet.</AssistantContextEmpty>
                </Show>
              </AssistantContextRows>
            </AssistantContextSection>

            <AssistantContextSection title="Images" count={images().length} onViewAll={() => void openImages()}>
              <Show when={images()[0]} fallback={<AssistantContextEmpty>No images yet.</AssistantContextEmpty>}>
                {(file) => (
                  <AssistantContextRow
                    icon="ti ti-photo"
                    title={file().path.replace(/^.*\//u, "")}
                    scope={file().scope}
                    showScope={hasMixedScope(images())}
                    onClick={() => void openImages(file())}
                  />
                )}
              </Show>
            </AssistantContextSection>

            <AssistantContextSection
              title="Files"
              count={regularFiles().length}
              onViewAll={() => void openAssistantContextFiles(regularFiles())}
            >
              <Show when={regularFiles()[0]} fallback={<AssistantContextEmpty>No files yet.</AssistantContextEmpty>}>
                {(file) => (
                  <AssistantContextRow
                    icon="ti ti-file"
                    title={file().path.replace(/^.*\//u, "")}
                    scope={file().scope}
                    showScope={hasMixedScope(regularFiles())}
                    onClick={() => void openAssistantContextFiles(regularFiles(), file())}
                  />
                )}
              </Show>
            </AssistantContextSection>

            <AssistantContextSection
              title="Scheduled"
              count={value().chat.tasks.length}
              onViewAll={() =>
                void prompts.dialog<void>(() => <AssistantTasksView chatId={value().chat.chatId} />, {
                  title: "Scheduled tasks",
                  icon: "ti ti-calendar-time",
                  size: "large",
                })
              }
            >
              <Show when={value().chat.tasks[0]} fallback={<AssistantContextEmpty>Nothing scheduled.</AssistantContextEmpty>}>
                {(task) => {
                  const status = () => taskStatus(task());
                  return (
                    <div class="flex items-start justify-between gap-2">
                      <span class="min-w-0">
                        <span class="block line-clamp-2 text-xs text-secondary">{task().prompt}</span>
                        <span class="mt-1 block truncate text-xs text-dimmed">{formatAssistantTaskSchedule(task())}</span>
                      </span>
                      <StatusBadge label={status().label} tone={status().tone} variant="text" />
                    </div>
                  );
                }}
              </Show>
            </AssistantContextSection>
            <Show when={lightbox()}>
              {(state) => (
                <Lightbox
                  images={state().images.map((entry) => entry.image)}
                  initialIndex={state().index}
                  onClose={() => setLightbox(null)}
                />
              )}
            </Show>
          </div>
        );
      }}
    </Show>
  );
}

export function AssistantChatContextContent(props: {
  chatId: string;
  project?: AiProject | null;
  initial?: AssistantChatContextSnapshot | null;
  onPresenceChange?: (hasContent: boolean | null) => void;
  onSnapshotChange?: (snapshot: AssistantChatContextSnapshot | null) => void;
}) {
  const state = createAssistantChatContextState(props);
  createEffect(() => {
    props.onPresenceChange?.(state.presence());
    props.onSnapshotChange?.(state.snapshot() ?? null);
  });
  return <AssistantChatContextView state={state} />;
}

export function AssistantChatContextPanel(props: {
  chatId: string;
  project?: AiProject | null;
  initial?: AssistantChatContextSnapshot | null;
  onPresenceChange?: (hasContent: boolean | null) => void;
  onSnapshotChange?: (snapshot: AssistantChatContextSnapshot | null) => void;
}) {
  const state = createAssistantChatContextState(props);
  createEffect(() => {
    props.onPresenceChange?.(state.presence());
    props.onSnapshotChange?.(state.snapshot() ?? null);
  });
  return (
    <Show when={state.presence() !== false}>
      <AssistantChatContextSurface>
        <AssistantChatContextView state={state} />
      </AssistantChatContextSurface>
    </Show>
  );
}

export const openAssistantChatContextDialog = (chatId: string, project: AiProject | null, live: AssistantLiveHub) =>
  prompts.dialog<void>(
    () => (
      <AssistantLiveProvider value={live}>
        <AssistantChatContextContent chatId={chatId} project={project} />
      </AssistantLiveProvider>
    ),
    { title: "Chat context", icon: "ti ti-adjustments-horizontal", size: "medium" },
  );
