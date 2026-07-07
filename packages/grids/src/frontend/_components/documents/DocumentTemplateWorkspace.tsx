import {
  CopyButton,
  Dropdown,
  dialogCore,
  PanelDialog,
  PdfPreview,
  Placeholder,
  panelDialogOptions,
  prompts,
  TagsInput,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation as mutations, timed as timing } from "@valentinkolb/stdlib/solid";
import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type {
  CreateDocumentLinkResponse,
  DocumentLink,
  DocumentLinkListResponse,
  DocumentLinkTtl,
  DocumentRunBrowseResponse,
  DocumentRunFolder,
  DocumentRunSummary,
  DocumentTemplate,
  DocumentTemplateSummary,
} from "../../../contracts";
import type { Table } from "../../../service";
import { openDocumentTemplateEditorDialog } from "../dialogs/TableAdminDialogs";
import RecordPicker from "../records/RecordPicker";
import { type GridsDocumentViewMode, setDocumentViewMode } from "../sidebar/GridsSettingsStore";
import { errorMessage } from "../utils/api-helpers";
import { downloadPdfResponse } from "./document-download";

type Props = {
  baseId: string;
  table: Table;
  template: DocumentTemplateSummary;
  editableTemplate: DocumentTemplate | null;
  canWriteTemplate: boolean;
  canManageTemplate: boolean;
  editMode: boolean;
  initialRecordId: string | null;
  initialDocumentViewMode: GridsDocumentViewMode;
  dateConfig?: DateContext;
};

type DocumentViewMode = GridsDocumentViewMode | "custom";

const iconActionClass =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center text-dimmed transition-colors hover:text-secondary disabled:cursor-not-allowed disabled:opacity-50";
const PAGE_SIZE = 200;
const DOCUMENT_LINK_TTL_OPTIONS: Array<{ value: DocumentLinkTtl; label: string; description: string }> = [
  { value: "1d", label: "1 day", description: "Short handoff" },
  { value: "7d", label: "7 days", description: "One week" },
  { value: "30d", label: "30 days", description: "Default" },
  { value: "90d", label: "90 days", description: "Long running" },
];
const documentGenerateDialogOptions = {
  ...panelDialogOptions,
  panelClassName: `${panelDialogOptions.panelClassName} h-[min(90vh,54rem)] w-[min(96vw,80rem)]`,
  contentClassName: "flex h-full min-h-0 p-0",
};

const formatRelativeTime = (iso: string, dateConfig?: DateContext): string => dates.formatDateTimeRelative(iso, dateConfig);
const formatDateTime = (iso: string, dateConfig?: DateContext): string =>
  new Intl.DateTimeFormat(dateConfig?.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: dateConfig?.timeZone,
  }).format(new Date(iso));
const formatMonthPath = (year: string, month: string, dateConfig?: DateContext): string => {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat(dateConfig?.locale, { month: "long", timeZone: "UTC" }).format(date);
};

const absoluteUrl = (url: string): string => {
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
};

const documentLinkStatus = (link: DocumentLink): { label: string; class: string; active: boolean } => {
  if (link.revokedAt) return { label: "Revoked", class: "tag", active: false };
  if (new Date(link.expiresAt).getTime() <= Date.now()) return { label: "Expired", class: "tag", active: false };
  return { label: "Active", class: "tag-blue", active: true };
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

function DisabledDropdownItem(props: { icon: string; label: string; title: string }) {
  return (
    <button
      type="button"
      class="flex w-full cursor-not-allowed items-center gap-3 px-4 py-2 text-sm text-zinc-400 opacity-70 dark:text-zinc-500"
      disabled
      title={props.title}
    >
      <i class={props.icon} />
      {props.label}
    </button>
  );
}

const openDocumentGenerateDialog = (args: {
  table: Table;
  template: DocumentTemplateSummary;
  initialRecordId: string | null;
  onGenerated: () => void | Promise<void>;
}) => dialogCore.open<void>((close) => <DocumentGenerateDialog args={args} close={close} />, documentGenerateDialogOptions);

function DocumentGenerateDialog(props: {
  args: {
    table: Table;
    template: DocumentTemplateSummary;
    initialRecordId: string | null;
    onGenerated: () => void | Promise<void>;
  };
  close: () => void;
}) {
  const [recordId, setRecordId] = createSignal(props.args.initialRecordId ?? "");
  const [filename, setFilename] = createSignal("");
  const [tags, setTags] = createSignal<string[]>([]);
  const [previewedRecordId, setPreviewedRecordId] = createSignal<string | null>(null);

  const setSelectedRecord = (next: string) => {
    setRecordId(next);
    setPreviewedRecordId(null);
  };

  const hasCurrentPreview = () => {
    const selected = recordId().trim();
    return selected.length > 0 && previewedRecordId() === selected;
  };

  const previewPdf = async () => {
    const selected = recordId().trim();
    if (!selected) throw new Error("Choose a record first.");
    setPreviewedRecordId(null);
    const res = await fetch(`/api/grids/documents/templates/${encodeURIComponent(props.args.template.id)}/preview-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordId: selected }),
    });
    if (res.ok && (res.headers.get("content-type") ?? "").includes("application/pdf")) setPreviewedRecordId(selected);
    return res;
  };

  const generateMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const selected = recordId().trim();
      if (!selected) throw new Error("Choose a record first.");
      if (!hasCurrentPreview()) throw new Error("Render a PDF preview before generating this document.");
      const res = await fetch(`/api/grids/documents/templates/${encodeURIComponent(props.args.template.id)}/generate`, {
        method: "POST",
        signal: abortSignal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: selected,
          filename: filename().trim() || undefined,
          tags: tags(),
        }),
      });
      await downloadPdfResponse(res, filename().trim() || `${props.args.template.name}.pdf`);
    },
    onSuccess: async () => {
      await props.args.onGenerated();
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={`Generate — ${props.args.template.name}`}
        subtitle={props.args.table.name}
        icon="ti ti-file-type-pdf"
        close={props.close}
      />
      <PanelDialog.Body>
        <section class="flex shrink-0 flex-col gap-2">
          <RecordPicker
            tableId={props.args.table.id}
            templateId={props.args.template.id}
            value={recordId}
            onChange={setSelectedRecord}
            label="Record"
            placeholder="Search records..."
          />
          <TextInput
            label="Filename"
            description="Optional override. Leave empty to use the template's Liquid filename pattern."
            value={filename}
            onInput={setFilename}
            icon="ti ti-file-text"
            placeholder="Use template default"
          />
          <TagsInput label="Tags" placeholder="customer, signed, 2026" value={tags} onChange={setTags} />
          <div class="info-block-info text-xs">
            <i class="ti ti-camera" />
            Generating stores a recursive snapshot. Redownloads use the stored snapshot and filename.
          </div>
        </section>

        <PdfPreview
          title="PDF preview"
          class="min-h-[30rem] shrink-0"
          buttonLabel="Render preview"
          emptyText="Choose a record and render a PDF preview before generating."
          disabled={() => !recordId().trim()}
          request={previewPdf}
        />
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.close} disabled={generateMut.loading()}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={() => generateMut.mutate(undefined)}
            disabled={generateMut.loading() || !hasCurrentPreview()}
          >
            {generateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
            Generate PDF
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

const openDocumentLinkDialog = (args: { run: DocumentRunSummary; onCreated: (link: DocumentLink) => void | Promise<void> }) =>
  dialogCore.open<void>((close) => <DocumentLinkDialog args={args} close={close} />, panelDialogOptions);

function DocumentLinkDialog(props: {
  args: {
    run: DocumentRunSummary;
    onCreated: (link: DocumentLink) => void | Promise<void>;
  };
  close: () => void;
}) {
  const [expiresIn, setExpiresIn] = createSignal<DocumentLinkTtl>("30d");
  const [comment, setComment] = createSignal("");
  const [createdUrl, setCreatedUrl] = createSignal<string | null>(null);

  const createMut = mutations.create<CreateDocumentLinkResponse, void>({
    mutation: async () => {
      const res = await apiClient.documents.runs[":runId"].links.$post({
        param: { runId: props.args.run.id },
        json: {
          expiresIn: expiresIn(),
          comment: comment().trim() || null,
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not create document link"));
      return res.json();
    },
    onSuccess: async (created) => {
      const url = absoluteUrl(created.url);
      setCreatedUrl(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // The visible copy button below is the fallback for locked-down browsers.
      }
      await props.args.onCreated(created.link);
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <PanelDialog.Header title="Create public link" subtitle={props.args.run.filename} icon="ti ti-link" close={props.close} />
      <PanelDialog.Body>
        <Show
          when={createdUrl()}
          fallback={
            <section class="flex flex-col gap-3">
              <div>
                <p class="text-sm font-medium text-primary">Validity</p>
                <div class="mt-2 grid gap-2 sm:grid-cols-2">
                  <For each={DOCUMENT_LINK_TTL_OPTIONS}>
                    {(option) => (
                      <button
                        type="button"
                        class={`rounded-md border px-3 py-2 text-left transition-colors ${
                          expiresIn() === option.value
                            ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200"
                            : "border-zinc-200 bg-white text-secondary hover:text-primary dark:border-zinc-800 dark:bg-zinc-950"
                        }`}
                        onClick={() => setExpiresIn(option.value)}
                      >
                        <span class="block text-sm font-medium">{option.label}</span>
                        <span class="block text-xs text-dimmed">{option.description}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <TextInput
                label="Comment"
                description="Optional internal note. It is not visible to people using the link."
                value={comment}
                onInput={setComment}
                icon="ti ti-message"
                placeholder="Why this link exists"
              />
              <div class="info-block-info text-xs">
                <i class="ti ti-shield-lock" />
                The URL works without login until it expires or is revoked. It downloads this stored document snapshot only.
              </div>
            </section>
          }
        >
          {(url) => (
            <section class="flex flex-col gap-3">
              <div class="info-block-success text-xs">
                <i class="ti ti-check" />
                Link created and copied to clipboard.
              </div>
              <code class="block break-all rounded-md bg-zinc-100 p-2 font-mono text-xs text-secondary dark:bg-zinc-900">
                {url()}
              </code>
              <div class="flex flex-wrap items-center gap-2">
                <CopyButton text={url()} label="Copy link" class="btn-input btn-sm" />
                <a href={url()} target="_blank" rel="noreferrer" class="btn-input btn-sm">
                  <i class="ti ti-external-link" />
                  Open link
                </a>
              </div>
            </section>
          )}
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.close} disabled={createMut.loading()}>
            {createdUrl() ? "Done" : "Cancel"}
          </button>
          <Show when={!createdUrl()}>
            <button type="button" class="btn-primary btn-sm" onClick={() => createMut.mutate(undefined)} disabled={createMut.loading()}>
              {createMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-link-plus" />}
              Create link
            </button>
          </Show>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

const openDocumentRunDetailsDialog = (args: {
  run: DocumentRunSummary;
  canWrite: boolean;
  dateConfig?: DateContext;
  onSaved: (run: DocumentRunSummary) => void | Promise<void>;
  onDownload: (run: DocumentRunSummary) => void | Promise<void>;
}) => dialogCore.open<void>((close) => <DocumentRunDetailsDialog args={args} close={close} />, panelDialogOptions);

function DocumentRunDetailsDialog(props: {
  args: {
    run: DocumentRunSummary;
    canWrite: boolean;
    dateConfig?: DateContext;
    onSaved: (run: DocumentRunSummary) => void | Promise<void>;
    onDownload: (run: DocumentRunSummary) => void | Promise<void>;
  };
  close: () => void;
}) {
  const [filename, setFilename] = createSignal(props.args.run.filename);
  const [tags, setTags] = createSignal<string[]>(props.args.run.tags);
  const [links, { refetch: refetchLinks }] = createResource(
    () => (props.args.canWrite ? props.args.run.id : null),
    async (runId): Promise<DocumentLink[]> => {
      if (!runId) return [];
      const res = await apiClient.documents.runs[":runId"].links.$get({ param: { runId } });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load document links"));
      return ((await res.json()) as DocumentLinkListResponse).items;
    },
  );

  const saveMut = mutations.create<DocumentRunSummary, void>({
    mutation: async () => {
      const res = await apiClient.documents.runs[":runId"].$patch({
        param: { runId: props.args.run.id },
        json: {
          filename: filename().trim(),
          tags: tags(),
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not update document"));
      return res.json();
    },
    onSuccess: async (run) => {
      await props.args.onSaved(run);
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  const revokeMut = mutations.create<DocumentLink, DocumentLink>({
    mutation: async (link) => {
      const res = await apiClient.documents.links[":linkId"].revoke.$post({ param: { linkId: link.id } });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not revoke document link"));
      return res.json();
    },
    onSuccess: async () => {
      await refetchLinks();
    },
    onError: (error) => prompts.error(error.message),
  });

  const createLink = () =>
    void openDocumentLinkDialog({
      run: props.args.run,
      onCreated: async () => {
        await refetchLinks();
      },
    });

  return (
    <PanelDialog>
      <PanelDialog.Header title="Document details" subtitle={props.args.run.filename} icon="ti ti-file-type-pdf" close={props.close} />
      <PanelDialog.Body>
        <section class="flex flex-col gap-2">
          <TextInput label="Filename" value={filename} onInput={setFilename} icon="ti ti-file-text" disabled={!props.args.canWrite} />
          <TagsInput label="Tags" placeholder="customer, signed, 2026" value={tags} onChange={setTags} disabled={!props.args.canWrite} />
          <dl class="grid gap-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
            <dt class="text-dimmed">Number</dt>
            <dd class="min-w-0 truncate font-mono text-xs text-secondary">{props.args.run.documentNumber}</dd>
            <dt class="text-dimmed">Created</dt>
            <dd class="text-secondary">{formatRelativeTime(props.args.run.generatedAt, props.args.dateConfig)}</dd>
            <dt class="text-dimmed">Snapshot</dt>
            <dd class="min-w-0 truncate font-mono text-xs text-secondary">{props.args.run.snapshotId}</dd>
          </dl>
        </section>
        <Show when={props.args.canWrite}>
          <section class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <div>
                <h3 class="text-sm font-semibold text-primary">Public links</h3>
                <p class="text-xs text-dimmed">Expiring download links for this stored document.</p>
              </div>
              <button type="button" class="btn-input btn-sm" onClick={createLink}>
                <i class="ti ti-link-plus" />
                New link
              </button>
            </div>
            <div class="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
              <Show when={!links.loading} fallback={<div class="p-3 text-sm text-dimmed">Loading links...</div>}>
                <Show when={!links.error} fallback={<div class="p-3 text-sm text-red-600">{links.error?.message ?? "Could not load links."}</div>}>
                  <Show when={(links() ?? []).length > 0} fallback={<div class="p-3 text-sm text-dimmed">No public links for this document.</div>}>
                    <For each={links()}>
                      {(link) => {
                        const status = () => documentLinkStatus(link);
                        return (
                          <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-zinc-100 px-3 py-2 last:border-b-0 dark:border-zinc-800">
                            <div class="min-w-0">
                              <div class="flex min-w-0 flex-wrap items-center gap-2">
                                <span class={status().class}>{status().label}</span>
                                <span class="text-xs text-secondary">Expires {formatDateTime(link.expiresAt, props.args.dateConfig)}</span>
                              </div>
                              <Show when={link.comment}>
                                {(comment) => <p class="mt-1 truncate text-sm text-primary">{comment()}</p>}
                              </Show>
                              <p class="mt-1 text-xs text-dimmed">
                                Created {formatRelativeTime(link.createdAt, props.args.dateConfig)}
                                {link.accessCount > 0 ? ` · ${link.accessCount} downloads` : ""}
                                {link.lastAccessedAt ? ` · last ${formatRelativeTime(link.lastAccessedAt, props.args.dateConfig)}` : ""}
                              </p>
                            </div>
                            <Show when={status().active}>
                              <button
                                type="button"
                                class={iconActionClass}
                                title="Revoke link"
                                aria-label="Revoke link"
                                onClick={() => void revokeMut.mutate(link)}
                                disabled={revokeMut.loading()}
                              >
                                {revokeMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-link-off" />}
                              </button>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </Show>
              </Show>
            </div>
            <p class="text-xs text-dimmed">For security, the full URL is only shown when the link is created.</p>
          </section>
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <button
          type="button"
          class="btn-input btn-sm"
          onClick={() => void props.args.onDownload(props.args.run)}
          disabled={saveMut.loading()}
        >
          <i class="ti ti-download" />
          Download
        </button>
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.close} disabled={saveMut.loading()}>
            Close
          </button>
          <Show when={props.args.canWrite}>
            <button type="button" class="btn-primary btn-sm" onClick={() => saveMut.mutate(undefined)} disabled={saveMut.loading()}>
              {saveMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-device-floppy" />}
              Save
            </button>
          </Show>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export default function DocumentTemplateWorkspace(props: Props) {
  const [searchDraft, setSearchDraft] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [viewMode, setViewMode] = createSignal<DocumentViewMode>(props.initialDocumentViewMode);
  const [folderPath, setFolderPath] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [runItems, setRunItems] = createSignal<DocumentRunSummary[]>([]);
  const [folderItems, setFolderItems] = createSignal<DocumentRunFolder[]>([]);
  const [runPage, setRunPage] = createSignal<{ total: number; hasMore: boolean; nextCursor: string | null }>({
    total: 0,
    hasMore: false,
    nextCursor: null,
  });

  const debouncedSearch = timing.debounce((next: string) => setSearch(next.trim()), 250);
  createEffect(() => {
    debouncedSearch.debouncedFn(searchDraft());
  });

  const fetchBrowserPage = async (args: {
    templateId: string;
    search: string;
    mode: "list" | "folders";
    path: string[];
    cursor?: string | null;
    signal?: AbortSignal;
  }): Promise<DocumentRunBrowseResponse> => {
    const res = await apiClient.documents.runs["by-template"][":templateId"].browse.$get(
      {
        param: { templateId: args.templateId },
        query: {
          q: args.search,
          limit: String(PAGE_SIZE),
          cursor: args.cursor ?? "",
          mode: args.mode,
          path: args.path.join("/"),
        },
      },
      args.signal ? { init: { signal: args.signal } } : undefined,
    );
    if (!res.ok) throw new Error(await errorMessage(res, "Could not load generated documents"));
    return (await res.json()) as DocumentRunBrowseResponse;
  };

  const activeViewMode = () => (search().trim() ? "list" : viewMode());
  const browserKey = () => ({
    templateId: props.template.id,
    search: search(),
    mode: activeViewMode() === "folders" ? ("folders" as const) : ("list" as const),
    path: activeViewMode() === "folders" ? folderPath() : [],
  });
  const browserKeyString = (key = browserKey()) => `${key.templateId}:${key.mode}:${key.search.trim()}:${key.path.join("/")}`;
  const [browser, { refetch: refetchBrowser }] = createResource(browserKey, async (key) =>
    fetchBrowserPage({ templateId: key.templateId, search: key.search.trim(), mode: key.mode, path: key.path }),
  );

  createEffect(() => {
    const page = browser();
    if (!page) return;
    setRunItems(page.items);
    setFolderItems(page.folders);
    setRunPage({
      total: page.total ?? page.items.length,
      hasMore: Boolean(page.hasMore),
      nextCursor: page.nextCursor ?? null,
    });
  });

  const loadMoreMut = mutations.create<DocumentRunBrowseResponse, void, { key: string; cursor: string }>({
    onBefore: () => {
      const cursor = runPage().nextCursor;
      if (!cursor) throw new Error("No more documents to load.");
      return { key: browserKeyString(), cursor };
    },
    mutation: async (_, { cursor, abortSignal }) => {
      const key = browserKey();
      return fetchBrowserPage({
        templateId: key.templateId,
        search: key.search.trim(),
        mode: key.mode,
        path: key.path,
        cursor,
        signal: abortSignal,
      });
    },
    onSuccess: (page, ctx) => {
      if (!ctx || ctx.key !== browserKeyString()) return;
      setRunItems((items) => [...items, ...page.items]);
      setRunPage({
        total: page.total ?? runPage().total,
        hasMore: Boolean(page.hasMore),
        nextCursor: page.nextCursor ?? null,
      });
    },
    onError: (error) => prompts.error(error.message),
  });

  const generatedRuns = () => runItems();
  const folders = () => folderItems();
  const documentCountLabel = () => {
    const total =
      activeViewMode() === "folders" && folders().length > 0 ? folders().reduce((sum, folder) => sum + folder.count, 0) : runPage().total;
    const loaded = generatedRuns().length;
    if (folders().length > 0) return `${total} documents`;
    return total > loaded ? `${loaded} of ${total} documents` : `${loaded} documents`;
  };

  const folderTitle = (folder: DocumentRunFolder) => {
    if (folder.kind === "year") return folder.label;
    const [year, month] = folder.path;
    return year && month ? formatMonthPath(year, month, props.dateConfig) : folder.label;
  };
  const breadcrumbs = () => {
    const path = folderPath();
    const items: Array<{ label: string; path: string[] }> = [{ label: "Documents", path: [] }];
    if (path[0]) items.push({ label: path[0], path: [path[0]] });
    if (path[0] && path[1]) items.push({ label: formatMonthPath(path[0], path[1], props.dateConfig), path: [path[0], path[1]] });
    return items;
  };
  const setMode = (mode: DocumentViewMode) => {
    if (mode === "custom") return;
    setViewMode(mode);
    setDocumentViewMode(mode);
    if (mode !== "folders") setFolderPath([]);
  };
  const openFolder = (folder: DocumentRunFolder) => {
    setViewMode("folders");
    setDocumentViewMode("folders");
    setFolderPath(folder.path);
  };
  const replaceRun = (next: DocumentRunSummary) => {
    setRunItems((items) => items.map((item) => (item.id === next.id ? next : item)));
  };
  const downloadRun = async (run: DocumentRunSummary, signal?: AbortSignal) => {
    const res = await fetch(`/api/grids/documents/runs/${encodeURIComponent(run.id)}/download`, signal ? { signal } : undefined);
    await downloadPdfResponse(res, run.filename);
  };
  const openCreateLink = (run: DocumentRunSummary) => {
    if (!props.canWriteTemplate) return;
    void openDocumentLinkDialog({
      run,
      onCreated: async () => {},
    });
  };
  const openRunDetails = (run: DocumentRunSummary) =>
    void openDocumentRunDetailsDialog({
      run,
      canWrite: props.canWriteTemplate,
      dateConfig: props.dateConfig,
      onSaved: replaceRun,
      onDownload: (item) => downloadRun(item),
    });

  const openGenerate = () => {
    if (!props.canWriteTemplate) return;
    void openDocumentGenerateDialog({
      table: props.table,
      template: props.template,
      initialRecordId: props.initialRecordId,
      onGenerated: async () => {
        await refetchBrowser();
      },
    });
  };

  const downloadMut = mutations.create<void, DocumentRunSummary, { runId: string }>({
    onBefore: (run) => {
      setBusy(run.id);
      return { runId: run.id };
    },
    mutation: async (run, { abortSignal }) => downloadRun(run, abortSignal),
    onError: (error) => prompts.error(error.message),
    onFinally: (ctx) => {
      if (ctx?.runId && busy() === ctx.runId) setBusy(null);
    },
  });

  const renderRunActions = (run: DocumentRunSummary) => (
    <div class="flex shrink-0 items-center gap-1">
      <Show when={props.canWriteTemplate}>
        <button
          type="button"
          class={iconActionClass}
          title="Edit document metadata"
          aria-label="Edit document metadata"
          onClick={(event) => {
            event.stopPropagation();
            openRunDetails(run);
          }}
        >
          <i class="ti ti-pencil" />
        </button>
      </Show>
      <Show when={props.canWriteTemplate}>
        <button
          type="button"
          class={iconActionClass}
          title="Create public link"
          aria-label="Create public link"
          onClick={(event) => {
            event.stopPropagation();
            openCreateLink(run);
          }}
        >
          <i class="ti ti-link" />
        </button>
      </Show>
      <button
        type="button"
        class={iconActionClass}
        title="Download document"
        aria-label="Download document"
        onClick={(event) => {
          event.stopPropagation();
          void downloadMut.mutate(run);
        }}
        disabled={busy() === run.id}
      >
        {busy() === run.id ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
      </button>
    </div>
  );

  const renderRunRow = (run: DocumentRunSummary) => (
    <div class="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-zinc-100 px-3 py-2 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-zinc-900/70">
      <button type="button" class="min-w-0 text-left" onClick={() => openRunDetails(run)}>
        <div class="flex min-w-0 items-center gap-2">
          <i class="ti ti-file-type-pdf shrink-0 text-dimmed" />
          <span class="truncate font-medium text-primary">{run.filename}</span>
        </div>
        <div class="mt-1 flex min-w-0 items-center gap-2 text-xs text-dimmed">
          <span class="font-mono">{run.documentNumber}</span>
          <DocumentTags tags={run.tags} />
        </div>
      </button>
      <span class="hidden text-xs text-dimmed sm:block">{formatRelativeTime(run.generatedAt, props.dateConfig)}</span>
      {renderRunActions(run)}
    </div>
  );

  const renderFolderRow = (folder: DocumentRunFolder) => (
    <button
      type="button"
      class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-100 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-zinc-900/70"
      onClick={() => openFolder(folder)}
    >
      <div class="flex min-w-0 items-center gap-2">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-secondary dark:bg-zinc-900">
          <i class="ti ti-folder" />
        </span>
        <span class="min-w-0">
          <span class="block truncate font-medium text-primary">{folderTitle(folder)}</span>
          <span class="block text-xs text-dimmed">{folder.count} documents</span>
        </span>
      </div>
      <i class="ti ti-chevron-right text-dimmed" />
    </button>
  );

  const showDocumentRows = () => activeViewMode() !== "folders" || generatedRuns().length > 0 || search().trim();
  const emptyText = () => {
    if (search().trim()) return "No documents match this search.";
    if (activeViewMode() === "folders" && folderPath().length > 0) return "This folder is empty.";
    return "No generated documents yet.";
  };
  const activeViewLabel = () => (activeViewMode() === "folders" ? "Folders" : "Table");
  const activeViewIcon = () => (activeViewMode() === "folders" ? "ti ti-folder" : "ti ti-table");
  const viewModeElements = () => [
    {
      icon: "ti ti-table",
      label: "Table",
      action: () => setMode("list"),
    },
    search().trim()
      ? {
          element: <DisabledDropdownItem icon="ti ti-folder" label="Folders" title="Folder view is disabled while searching." />,
        }
      : {
          icon: "ti ti-folder",
          label: "Folders",
          action: () => setMode("folders"),
        },
    {
      element: <DisabledDropdownItem icon="ti ti-folder-cog" label="Custom" title="Custom folders are not configured yet." />,
    },
  ];

  return (
    <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden" data-scroll-preserve="grids-document-template-workspace">
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <Show when={props.canWriteTemplate}>
          <button type="button" class="btn-input-primary btn-input-sm" onClick={openGenerate}>
            <i class="ti ti-plus" />
            Add new
          </button>
        </Show>
        <div class="min-w-64 flex-1">
          <TextInput
            type="search"
            icon="ti ti-search"
            placeholder="Search documents..."
            value={searchDraft}
            onInput={setSearchDraft}
            clearable
            onClear={() => {
              setSearchDraft("");
              setSearch("");
            }}
          />
        </div>
        <Dropdown
          position="bottom-left"
          trigger={
            <span class="btn-input btn-input-sm">
              <i class={activeViewIcon()} />
              {activeViewLabel()}
              <i class="ti ti-chevron-down text-[10px] opacity-60" />
            </span>
          }
          elements={viewModeElements()}
        />
        <span class="whitespace-nowrap text-xs text-dimmed">{documentCountLabel()}</span>
      </div>
      <Show when={props.editMode && props.canManageTemplate ? props.editableTemplate : null}>
        {(editableTemplate) => (
          <div class="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn-input-success btn-input-sm"
              onClick={() =>
                openDocumentTemplateEditorDialog({
                  baseId: props.baseId,
                  tableId: props.table.id,
                  tableName: props.table.name,
                  template: editableTemplate(),
                  onSaved: () => refreshCurrentPath(),
                })
              }
            >
              <i class="ti ti-settings" />
              Manage
            </button>
          </div>
        )}
      </Show>

      <section class="paper min-h-0 flex-1 overflow-hidden">
        <Show when={!browser.loading} fallback={<div class="p-3 text-sm text-dimmed">Loading documents...</div>}>
          <Show
            when={!browser.error}
            fallback={<Placeholder class="h-full">{browser.error?.message ?? "Could not load generated documents."}</Placeholder>}
          >
            <div class="flex h-full min-h-0 flex-col overflow-hidden">
              <Show when={activeViewMode() === "folders" && !search().trim()}>
                <div class="flex shrink-0 items-center gap-1 border-b border-zinc-100 px-3 py-2 text-xs text-secondary dark:border-zinc-800/70">
                  <For each={breadcrumbs()}>
                    {(crumb, index) => (
                      <>
                        <Show when={index() > 0}>
                          <i class="ti ti-chevron-right text-dimmed" />
                        </Show>
                        <button
                          type="button"
                          class={`rounded px-1 py-0.5 hover:text-primary ${index() === breadcrumbs().length - 1 ? "font-medium text-primary" : ""}`}
                          onClick={() => setFolderPath(crumb.path)}
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
                  when={folders().length > 0 || generatedRuns().length > 0}
                  fallback={<Placeholder class="h-full">{emptyText()}</Placeholder>}
                >
                  <Show when={activeViewMode() === "folders" && !search().trim() && folders().length > 0}>
                    <For each={folders()}>{renderFolderRow}</For>
                  </Show>
                  <Show when={showDocumentRows()}>
                    <For each={generatedRuns()}>{renderRunRow}</For>
                    <Show when={runPage().hasMore}>
                      <div class="flex justify-center p-3">
                        <button
                          type="button"
                          class="btn-input btn-input-sm"
                          onClick={() => void loadMoreMut.mutate(undefined)}
                          disabled={loadMoreMut.loading()}
                        >
                          {loadMoreMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-dots" />}
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
    </div>
  );
}
