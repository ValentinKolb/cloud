import { Placeholder } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { For, Show } from "solid-js";
import type { DocumentRunFolder, DocumentRunSummary } from "../../../contracts";
import { documentRunActionState } from "./document-browser-model";
import { documentIconActionClass, formatDocumentRelativeTime } from "./document-workspace-utils";

export type DocumentBreadcrumb = { label: string; path: string[] };

type Props = {
  loading: boolean;
  error: Error | undefined;
  mode: "list" | "folders";
  searching: boolean;
  folders: DocumentRunFolder[];
  runs: DocumentRunSummary[];
  breadcrumbs: DocumentBreadcrumb[];
  emptyText: string;
  hasMore: boolean;
  loadingMore: boolean;
  busyRunId: string | null;
  canWrite: boolean;
  dateConfig?: DateContext;
  folderTitle: (folder: DocumentRunFolder) => string;
  onBreadcrumb: (path: string[]) => void;
  onFolder: (folder: DocumentRunFolder) => void;
  onRun: (run: DocumentRunSummary) => void;
  onEdit: (run: DocumentRunSummary) => void;
  onLink: (run: DocumentRunSummary) => void;
  onDownload: (run: DocumentRunSummary) => void;
  onLoadMore: () => void;
};

function DocumentTags(props: { tags: string[] }) {
  return (
    <Show when={props.tags.length > 0} fallback={<span class="text-dimmed">-</span>}>
      <span class="flex min-w-0 flex-wrap items-center gap-1">
        <For each={props.tags}>{(tag) => <span class="tag max-w-32 truncate">{tag}</span>}</For>
      </span>
    </Show>
  );
}

export default function DocumentBrowser(props: Props) {
  const renderRunActions = (run: DocumentRunSummary) => {
    const state = () => documentRunActionState(props.canWrite, props.busyRunId, run.id);
    return (
      <div class="flex shrink-0 items-center gap-1">
        <Show when={state().showEdit}>
          <button
            type="button"
            class={documentIconActionClass}
            title="Edit document metadata"
            aria-label="Edit document metadata"
            onClick={(event) => {
              event.stopPropagation();
              props.onEdit(run);
            }}
          >
            <i class="ti ti-pencil" />
          </button>
          <button
            type="button"
            class={documentIconActionClass}
            title="Create public link"
            aria-label="Create public link"
            onClick={(event) => {
              event.stopPropagation();
              props.onLink(run);
            }}
          >
            <i class="ti ti-link" />
          </button>
        </Show>
        <button
          type="button"
          class={documentIconActionClass}
          title="Download document"
          aria-label="Download document"
          onClick={(event) => {
            event.stopPropagation();
            props.onDownload(run);
          }}
          disabled={state().downloadBusy}
        >
          {state().downloadBusy ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
        </button>
      </div>
    );
  };

  return (
    <section class="paper min-h-0 flex-1 overflow-hidden">
      <Show when={!props.loading} fallback={<div class="p-3 text-sm text-dimmed">Loading documents...</div>}>
        <Show
          when={!props.error}
          fallback={<Placeholder class="h-full">{props.error?.message ?? "Could not load generated documents."}</Placeholder>}
        >
          <div class="flex h-full min-h-0 flex-col overflow-hidden">
            <Show when={props.mode === "folders" && !props.searching}>
              <div class="flex shrink-0 items-center gap-1 border-b border-zinc-100 px-3 py-2 text-xs text-secondary dark:border-zinc-800/70">
                <For each={props.breadcrumbs}>
                  {(crumb, index) => (
                    <>
                      <Show when={index() > 0}>
                        <i class="ti ti-chevron-right text-dimmed" />
                      </Show>
                      <button
                        type="button"
                        class={`rounded px-1 py-0.5 hover:text-primary ${
                          index() === props.breadcrumbs.length - 1 ? "font-medium text-primary" : ""
                        }`}
                        onClick={() => props.onBreadcrumb(crumb.path)}
                      >
                        {crumb.label}
                      </button>
                    </>
                  )}
                </For>
              </div>
            </Show>
            <div class="min-h-0 flex-1 overflow-auto">
              <Show
                when={props.folders.length > 0 || props.runs.length > 0}
                fallback={<Placeholder class="h-full">{props.emptyText}</Placeholder>}
              >
                <Show when={props.mode === "folders" && !props.searching && props.folders.length > 0}>
                  <For each={props.folders}>
                    {(folder) => (
                      <button
                        type="button"
                        class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-100 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-zinc-900/70"
                        onClick={() => props.onFolder(folder)}
                      >
                        <div class="flex min-w-0 items-center gap-2">
                          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-secondary dark:bg-zinc-900">
                            <i class="ti ti-folder" />
                          </span>
                          <span class="min-w-0">
                            <span class="block truncate font-medium text-primary">{props.folderTitle(folder)}</span>
                            <span class="block text-xs text-dimmed">{folder.count} documents</span>
                          </span>
                        </div>
                        <i class="ti ti-chevron-right text-dimmed" />
                      </button>
                    )}
                  </For>
                </Show>
                <Show when={props.mode !== "folders" || props.runs.length > 0 || props.searching}>
                  <For each={props.runs}>
                    {(run) => (
                      <div class="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-zinc-100 px-3 py-2 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-zinc-900/70">
                        <button type="button" class="min-w-0 text-left" onClick={() => props.onRun(run)}>
                          <div class="flex min-w-0 items-center gap-2">
                            <i class="ti ti-file-type-pdf shrink-0 text-dimmed" />
                            <span class="truncate font-medium text-primary">{run.filename}</span>
                          </div>
                          <div class="mt-1 flex min-w-0 items-center gap-2 text-xs text-dimmed">
                            <span class="font-mono">{run.documentNumber}</span>
                            <DocumentTags tags={run.tags} />
                          </div>
                        </button>
                        <span class="hidden text-xs text-dimmed sm:block">
                          {formatDocumentRelativeTime(run.generatedAt, props.dateConfig)}
                        </span>
                        {renderRunActions(run)}
                      </div>
                    )}
                  </For>
                  <Show when={props.hasMore}>
                    <div class="flex justify-center p-3">
                      <button type="button" class="btn-input btn-input-sm" onClick={props.onLoadMore} disabled={props.loadingMore}>
                        {props.loadingMore ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-dots" />}
                        Load more documents
                      </button>
                    </div>
                  </Show>
                </Show>
              </Show>
            </div>
          </div>
        </Show>
      </Show>
    </section>
  );
}
