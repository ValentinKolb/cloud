import type { HelpDocumentManifest, HelpDocumentPayload, HelpSearchPayload } from "@valentinkolb/cloud/shared";
import { hotkeys } from "@valentinkolb/stdlib/solid";
import { children, createEffect, createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { MarkdownView, prompts } from "../ui";
import { appAccentStyle } from "./app-appearance";
import { type GlobalSearchHelpApp, openGlobalSearchHelpDialog } from "./GlobalSearchHelpDialog";
import { HELP_PAGE_PARAM, layoutHelpPageHref } from "./layout-help-url";

type HelpTopicBase = {
  id: string;
  title: string;
  icon?: string;
  description?: string;
  order?: number;
};

export type LayoutHelpTab = HelpTopicBase & { children: JSX.Element };
export type LayoutHelpProps = LayoutHelpTab;
export type LayoutHelpDocumentsProps = { documents: readonly HelpDocumentManifest[] };
export type LayoutHelpPageProps = {
  documents: readonly HelpDocumentManifest[];
  initialTopic?: string;
  includeShortcuts?: boolean;
  accent?: string;
  /** Render inside an app-owned pane instead of occupying a standalone page. */
  embedded?: boolean;
};

type HelpTopic = (HelpTopicBase & { kind: "content"; children: JSX.Element }) | (HelpDocumentManifest & { kind: "document" });
type HelpView = "hub" | "search" | "article";
type HelpSession = {
  view: HelpView;
  query: string;
  activeId: string | null;
  articleScrollTop: number;
  articleCache: Map<string, HelpDocumentPayload>;
};

const HELP_TOPICS_EVENT = "cloud:layout-help-topics";
const LAST_TOPIC_KEY = "cloud.layoutHelp.activeTopic";

declare global {
  interface Window {
    __cloudLayoutHelpTopics?: Map<string, HelpTopic>;
  }
}

const registry = () => {
  if (typeof window === "undefined") return null;
  window.__cloudLayoutHelpTopics ??= new Map<string, HelpTopic>();
  return window.__cloudLayoutHelpTopics;
};

const emitTopicsChanged = () => window.dispatchEvent(new Event(HELP_TOPICS_EVENT));
const iconClass = (icon?: string) => (icon?.startsWith("ti ") ? icon : `ti ${icon ?? "ti-circle"}`);
const legacyTopicContent = (topic: HelpTopic) => (topic.kind === "content" ? topic.children : null);
const sortedTopics = () =>
  [...(registry()?.values() ?? [])].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));
const documentTopics = (documents: readonly HelpDocumentManifest[] = []): HelpTopic[] =>
  documents.map((document) => ({ ...document, kind: "document" }));
const mergeTopics = (registered: readonly HelpTopic[], documents: readonly HelpDocumentManifest[] = []): HelpTopic[] => {
  const topics = new Map(registered.map((topic) => [topic.id, topic]));
  for (const topic of documentTopics(documents)) topics.set(topic.id, topic);
  return [...topics.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));
};

const registerTopic = (topic: HelpTopic) => {
  const topics = registry();
  if (!topics) return () => {};
  topics.set(topic.id, topic);
  emitTopicsChanged();
  return () => {
    if (topics.get(topic.id) !== topic) return;
    topics.delete(topic.id);
    emitTopicsChanged();
  };
};

export function LayoutHelp(props: LayoutHelpProps) {
  const resolved = children(() => props.children);
  onMount(() => onCleanup(registerTopic({ ...props, kind: "content", children: resolved() })));
  return null;
}

/** Register an app's server-prepared Markdown manifest with the shared help UI. */
export function LayoutHelpDocuments(props: LayoutHelpDocumentsProps) {
  onMount(() => {
    const disposers = props.documents.map((document) => registerTopic({ ...document, kind: "document" }));
    onCleanup(() => disposers.forEach((dispose) => dispose()));
  });
  return null;
}

const Shortcuts = (props: { openSearchHelp: () => void }) => {
  const entries = createMemo(() => [...hotkeys.entries()].sort((a, b) => a.label.localeCompare(b.label) || a.keys.localeCompare(b.keys)));
  return (
    <div class="flex flex-col gap-3">
      <p class="text-sm leading-relaxed text-dimmed">Shortcuts follow the current app and view. This list updates automatically.</p>
      <button type="button" class="btn-secondary btn-sm self-start" onClick={props.openSearchHelp}>
        <i class="ti ti-search" /> Search help
      </button>
      <div class="flex flex-col gap-2">
        <For each={entries()}>
          {(entry) => (
            <div class="flex items-start justify-between gap-4 rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-subtle)] px-3 py-2.5">
              <div class="min-w-0">
                <p class="text-sm font-medium text-primary">{entry.label}</p>
                <Show when={entry.desc}>
                  <p class="mt-0.5 text-xs text-dimmed">{entry.desc}</p>
                </Show>
              </div>
              <div class="flex shrink-0 gap-1" role="group" aria-label={entry.keysPretty.map((part) => part.ariaLabel).join(" + ")}>
                <For each={entry.keysPretty}>
                  {(part) => (
                    <kbd class="rounded bg-[var(--ui-surface-raised)] px-1.5 py-1 text-[11px] ring-1 ring-black/10 dark:ring-white/10">
                      {part.key}
                    </kbd>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

const HelpShell = (props: {
  session: HelpSession;
  close: () => void;
  pageHref?: (topicId: string | null) => string;
  searchHelpApps: GlobalSearchHelpApp[];
  documents?: readonly HelpDocumentManifest[];
  includeShortcuts?: boolean;
  accent?: string;
  surface?: "modal" | "page" | "embedded";
  syncPageUrl?: boolean;
}) => {
  const [externalTopics, setExternalTopics] = createSignal(mergeTopics(sortedTopics(), props.documents));
  const [view, setView] = createSignal<HelpView>(props.session.view);
  const [query, setQuery] = createSignal(props.session.query);
  const [activeId, setActiveId] = createSignal<string | null>(props.session.activeId);
  const [payload, setPayload] = createSignal<HelpDocumentPayload | null>(null);
  const [loading, setLoading] = createSignal(props.session.view === "article");
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [loadAttempt, setLoadAttempt] = createSignal(0);
  const [remoteMatches, setRemoteMatches] = createSignal<ReadonlySet<string>>(new Set());
  const [searching, setSearching] = createSignal(false);
  let root: HTMLDivElement | undefined;
  let scrollArea: HTMLDivElement | undefined;
  let requestVersion = 0;
  let searchVersion = 0;

  const restoreArticleScroll = () =>
    requestAnimationFrame(() => {
      if (scrollArea && view() === "article") scrollArea.scrollTop = props.session.articleScrollTop;
    });

  const shortcutsTopic = createMemo<HelpTopic>(() => ({
    id: "shortcuts",
    title: "Shortcuts",
    icon: "ti ti-keyboard",
    description: "Keyboard actions for the current page.",
    order: 0,
    kind: "content",
    children: <Shortcuts openSearchHelp={() => openGlobalSearchHelpDialog(props.searchHelpApps)} />,
  }));
  const topics = createMemo(() => (props.includeShortcuts === false ? externalTopics() : [shortcutsTopic(), ...externalTopics()]));
  const activeTopic = createMemo(() => topics().find((topic) => topic.id === activeId()) ?? null);
  const normalizedQuery = createMemo(() => query().trim().toLocaleLowerCase());
  const results = createMemo(() => {
    const value = normalizedQuery();
    if (!value) return topics();
    const matches = remoteMatches();
    return topics().filter(
      (topic) => [topic.title, topic.description].some((part) => part?.toLocaleLowerCase().includes(value)) || matches.has(topic.id),
    );
  });

  createEffect(() => {
    const value = normalizedQuery();
    const urls = [
      ...new Set(
        externalTopics()
          .filter((topic): topic is HelpDocumentManifest & { kind: "document" } => topic.kind === "document")
          .map((topic) => topic.searchUrl),
      ),
    ];
    const version = ++searchVersion;
    setRemoteMatches(new Set<string>());
    setSearching(false);
    if (!value || urls.length === 0) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void Promise.all(
        urls.map(async (url) => {
          const response = await fetch(`${url}?q=${encodeURIComponent(value)}`, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          });
          if (!response.ok) throw new Error(`Help search failed (${response.status})`);
          const payload = (await response.json()) as Partial<HelpSearchPayload>;
          return Array.isArray(payload.ids) ? payload.ids.filter((id): id is string => typeof id === "string") : [];
        }),
      )
        .then((groups) => {
          if (version === searchVersion) setRemoteMatches(new Set<string>(groups.flat()));
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          // Metadata matches stay usable if full-text search is temporarily unavailable.
        })
        .finally(() => {
          if (version === searchVersion) setSearching(false);
        });
    }, 120);

    onCleanup(() => {
      window.clearTimeout(timer);
      controller.abort();
      if (version === searchVersion) searchVersion++;
    });
  });

  const syncSession = () => {
    props.session.view = view();
    props.session.query = query();
    props.session.activeId = activeId();
  };
  createEffect(syncSession);

  onMount(() => {
    const dialog = root?.closest("dialog");
    if (dialog) {
      dialog.setAttribute("aria-labelledby", "layout-help-title");
      dialog.setAttribute("aria-describedby", "layout-help-subtitle");
    }
    const update = () => setExternalTopics(mergeTopics(sortedTopics(), props.documents));
    window.addEventListener(HELP_TOPICS_EVENT, update);
    update();
    onCleanup(() => window.removeEventListener(HELP_TOPICS_EVENT, update));
    restoreArticleScroll();
  });

  createEffect(() => {
    loadAttempt();
    const topic = activeTopic();
    const version = ++requestVersion;
    setPayload(null);
    setLoadError(null);
    setLoading(false);
    if (!topic || topic.kind !== "document" || view() !== "article") return;
    const cached = props.session.articleCache.get(topic.url);
    if (cached) {
      setPayload(cached);
      restoreArticleScroll();
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    void fetch(topic.url, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Help request failed (${response.status})`);
        const value = (await response.json()) as Partial<HelpDocumentPayload>;
        if (
          value.id !== topic.id ||
          typeof value.html !== "string" ||
          typeof value.markdown !== "string" ||
          typeof value.title !== "string"
        ) {
          throw new Error("Help server returned an invalid document");
        }
        const document = value as HelpDocumentPayload;
        props.session.articleCache.set(topic.url, document);
        if (version === requestVersion) {
          setPayload(document);
          restoreArticleScroll();
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (version === requestVersion) setLoadError(error instanceof Error ? error.message : "Could not load help");
      })
      .finally(() => {
        if (version === requestVersion) setLoading(false);
      });
    onCleanup(() => {
      controller.abort();
      if (version === requestVersion) requestVersion++;
    });
  });

  const openTopic = (id: string) => {
    props.session.articleScrollTop = 0;
    setActiveId(id);
    setView("article");
    if (props.syncPageUrl) history.replaceState(history.state, "", layoutHelpPageHref(window.location.href, id));
    try {
      localStorage.setItem(LAST_TOPIC_KEY, id);
    } catch {
      /* Help does not depend on storage. */
    }
  };
  const goBack = () => {
    setView(query().trim() ? "search" : "hub");
    if (props.syncPageUrl) history.replaceState(history.state, "", layoutHelpPageHref(window.location.href, null));
  };

  const TopicList = (listProps: { items: HelpTopic[] }) => (
    <div class="flex flex-col gap-1 rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-subtle)] p-1.5">
      <For each={listProps.items}>
        {(topic) => (
          <button
            type="button"
            class="group flex w-full items-center gap-3 rounded-[var(--ui-radius-control)] px-3 py-2.5 text-left hover:bg-[var(--ui-surface-raised)] focus-ui"
            onClick={() => openTopic(topic.id)}
          >
            <span class="help-topic-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] app-accent-text">
              <i class={`${iconClass(topic.icon)} text-base`} />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-primary group-hover:app-accent-text">{topic.title}</span>
              <Show when={topic.description}>
                {(description) => <span class="mt-0.5 block truncate text-xs text-dimmed">{description()}</span>}
              </Show>
            </span>
            <i class="ti ti-chevron-right shrink-0 text-xs text-dimmed" />
          </button>
        )}
      </For>
    </div>
  );

  return (
    <div
      ref={root}
      class={`app-accent-scope flex min-h-0 flex-col bg-[var(--ui-surface-raised)] ${
        props.surface === "modal"
          ? "h-[min(86vh,48rem)] overflow-hidden panel-dialog-shell [box-shadow:var(--ui-shadow-float)]"
          : props.surface === "page"
            ? "min-h-screen"
            : "h-full"
      }`}
      style={appAccentStyle(props.accent)}
    >
      <Show when={props.surface === "modal"}>
        <header class="flex h-16 shrink-0 items-center gap-3 px-5">
          <span class="flex h-9 w-9 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-muted)]">
            <i class="ti ti-help text-lg app-accent-text" />
          </span>
          <div class="min-w-0 flex-1">
            <h2 id="layout-help-title" class="font-semibold">
              Help
            </h2>
            <p id="layout-help-subtitle" class="text-xs text-dimmed">
              Guides, workflows, and shortcuts
            </p>
          </div>
          <Show when={props.pageHref}>
            {(pageHref) => (
              <a
                href={pageHref()(view() === "article" ? activeId() : null)}
                target="_blank"
                rel="noopener noreferrer"
                class="icon-btn"
                aria-label="Open help in a new browser window"
                title="Open full-page help"
              >
                <i class="ti ti-app-window" />
              </a>
            )}
          </Show>
          <button type="button" class="icon-btn" aria-label="Close help" onClick={props.close}>
            <i class="ti ti-x" />
          </button>
        </header>
      </Show>

      <div
        ref={scrollArea}
        class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
        onScroll={(event) => {
          if (view() === "article") props.session.articleScrollTop = event.currentTarget.scrollTop;
        }}
      >
        <Show when={view() === "hub"}>
          <div class="mx-auto flex max-w-3xl flex-col gap-6">
            <div>
              <h3 class="text-xl font-semibold text-primary">How can we help?</h3>
              <p class="mt-1 text-sm text-dimmed">Find a task, concept, or shortcut for the current app.</p>
            </div>
            <label class="field flex h-11 items-center gap-2 px-3">
              <i class="ti ti-search text-dimmed" />
              <input
                class="min-w-0 flex-1 bg-transparent text-sm outline-none"
                value={query()}
                placeholder="Search help…"
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  if (event.currentTarget.value.trim()) setView("search");
                }}
              />
            </label>
            <section aria-labelledby="help-start-title">
              <h4 id="help-start-title" class="mb-2 text-xs font-semibold uppercase tracking-wide text-dimmed">
                Start here
              </h4>
              <TopicList items={topics().slice(0, 5)} />
            </section>
            <Show when={topics().length > 5}>
              <section aria-labelledby="help-all-title">
                <h4 id="help-all-title" class="mb-2 text-xs font-semibold uppercase tracking-wide text-dimmed">
                  All topics
                </h4>
                <TopicList items={topics().slice(5)} />
              </section>
            </Show>
          </div>
        </Show>

        <Show when={view() === "search"}>
          <div class="mx-auto flex max-w-3xl flex-col gap-4">
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="icon-btn"
                aria-label="Back to help"
                onClick={() => {
                  setQuery("");
                  setView("hub");
                }}
              >
                <i class="ti ti-arrow-left" />
              </button>
              <label class="field flex h-11 flex-1 items-center gap-2 px-3">
                <i class="ti ti-search text-dimmed" />
                <input
                  autofocus
                  class="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  value={query()}
                  placeholder="Search help…"
                  onInput={(event) => setQuery(event.currentTarget.value)}
                />
              </label>
            </div>
            <p class="flex items-center gap-1.5 text-xs text-dimmed" aria-live="polite">
              <Show when={searching()}>
                <i class="ti ti-loader-2 animate-spin" aria-hidden="true" />
              </Show>
              {results().length} {results().length === 1 ? "result" : "results"}
            </p>
            <TopicList items={results()} />
            <Show when={results().length === 0 && !searching()}>
              <div class="rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-subtle)] p-6 text-center">
                <i class="ti ti-search-off text-xl text-dimmed" />
                <p class="mt-2 text-sm font-medium">No help topic matches this search.</p>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={view() === "article" && activeTopic()}>
          {(topic) => (
            <article class="mx-auto max-w-5xl">
              <button
                type="button"
                class="mb-6 inline-flex items-center gap-1.5 text-xs font-medium text-dimmed hover:app-accent-text focus-ui"
                onClick={goBack}
              >
                <i class="ti ti-arrow-left" /> Back
              </button>
              <header class="mb-8 flex items-start gap-3">
                <span class="help-topic-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] app-accent-text">
                  <i class={`${iconClass(topic().icon)} text-lg`} />
                </span>
                <div class="min-w-0">
                  <h3 class="text-2xl font-semibold tracking-tight text-primary">{topic().title}</h3>
                  <Show when={topic().description}>
                    {(description) => <p class="mt-1.5 text-sm leading-relaxed text-dimmed">{description()}</p>}
                  </Show>
                </div>
              </header>
              <Show when={topic().kind === "content"}>{legacyTopicContent(topic())}</Show>
              <Show when={topic().kind === "document"}>
                <Show when={loading()}>
                  <div class="flex items-center gap-2 py-8 text-sm text-dimmed">
                    <i class="ti ti-loader-2 animate-spin" /> Loading help…
                  </div>
                </Show>
                <Show when={loadError()}>
                  {(message) => (
                    <div class="info-block-danger">
                      <p class="font-medium">Could not load this topic</p>
                      <p class="mt-1 text-sm">{message()}</p>
                      <button type="button" class="btn-secondary btn-sm mt-3" onClick={() => setLoadAttempt((value) => value + 1)}>
                        Try again
                      </button>
                    </div>
                  )}
                </Show>
                <Show when={payload()}>{(document) => <MarkdownView html={document().html} class="help-document" />}</Show>
              </Show>
            </article>
          )}
        </Show>
      </div>
    </div>
  );
};

const createSession = (initialTopic?: string): HelpSession => {
  let activeId: string | null = initialTopic ?? null;
  if (!activeId && typeof window !== "undefined") {
    try {
      activeId = localStorage.getItem(LAST_TOPIC_KEY);
    } catch {
      /* Storage is optional. */
    }
  }
  return {
    view: initialTopic ? "article" : "hub",
    query: "",
    activeId,
    articleScrollTop: 0,
    articleCache: new Map(),
  };
};

/**
 * Render the shared Help experience as a full page. Apps pass the same
 * manifest used by `Layout.HelpDocuments`; article bodies still load lazily
 * from the app-owned authenticated Help API.
 */
export function LayoutHelpPage(props: LayoutHelpPageProps) {
  const session = createSession(props.initialTopic);
  return (
    <HelpShell
      session={session}
      close={() => {}}
      searchHelpApps={[]}
      documents={props.documents}
      includeShortcuts={props.includeShortcuts}
      accent={props.accent}
      surface={props.embedded ? "embedded" : "page"}
    />
  );
}

/** Render a reload-safe full-page Help view when the current URL opts in. */
export function LayoutHelpBrowserPage(props: { searchHelpApps?: GlobalSearchHelpApp[]; accent?: string }) {
  const [topic, setTopic] = createSignal<string | null | undefined>(undefined);

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has(HELP_PAGE_PARAM)) setTopic(params.get(HELP_PAGE_PARAM));
  });

  return (
    <Show when={topic() !== undefined}>
      <div class="fixed inset-0 z-[100] overflow-y-auto bg-[var(--ui-surface-raised)]">
        <HelpShell
          session={createSession(topic() || undefined)}
          close={() => {}}
          searchHelpApps={props.searchHelpApps ?? []}
          includeShortcuts={false}
          accent={props.accent}
          surface="page"
          syncPageUrl
        />
      </div>
    </Show>
  );
}

export function openLayoutHelpDialog(searchHelpApps: GlobalSearchHelpApp[] = [], accent?: string) {
  const session = createSession();
  void prompts.dialog<void>(
    (close) => (
      <HelpShell
        session={session}
        close={close}
        searchHelpApps={searchHelpApps}
        accent={accent}
        surface="modal"
        pageHref={(topicId) => layoutHelpPageHref(window.location.href, topicId)}
      />
    ),
    { surface: "bare", header: false, size: "wide" },
  );
}
