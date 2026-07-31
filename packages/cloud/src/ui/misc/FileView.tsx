/**
 * FileView — renders one file through a small renderer registry keyed by
 * media type / path. Editing is enabled purely by the presence of `save`;
 * without it every renderer is read-only. IDE-style chrome: editors reuse
 * the markdown editor's surface (toolbar with an in-toolbar save, Ctrl/Cmd+S),
 * previews are quiet paper panels with icon-only actions overlaid top-right.
 * Custom renderers (e.g. office previews in a future Files app) register via
 * registerFileViewRenderer.
 */

import { mutation } from "@k2b/stdlib/solid";
import { type Component, createMemo, createResource, createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import { markdown } from "../../shared";
import MarkdownEditor from "../input/markdown/MarkdownEditor";
import { toast } from "../toast";
import CodeDisplay, { type CodeDisplayLanguage } from "./CodeDisplay";
import { type FileViewFile, fileViewExtension, getFileViewPreviewKind, parseDelimitedText } from "./file-view-preview";
import MarkdownView from "./MarkdownView";
import Placeholder from "./Placeholder";
import StructuredDataPreview from "./StructuredDataPreview";

export type { FileViewFile, FileViewPreviewKind } from "./file-view-preview";
export { canPreviewFile, getFileViewPreviewKind } from "./file-view-preview";
export type FileViewContent = { encoding: "utf8" | "base64"; content: string; mediaType: string };

export type FileViewProps = {
  file: FileViewFile;
  load: () => Promise<FileViewContent>;
  /** Presence enables editing for text-based renderers. */
  save?: (content: string) => Promise<void>;
  /** Authenticated inline URL used by browser-native image, PDF, audio, and video previews. */
  previewHref?: string | null;
  downloadHref?: string | null;
  class?: string;
};

export type FileViewRendererProps = {
  file: FileViewFile;
  content: FileViewContent;
  previewHref: string | null;
  downloadHref: string | null;
  /** Null when the file is read-only. */
  editor: {
    draft: () => string;
    setDraft: (value: string) => void;
    dirty: () => boolean;
    saving: () => boolean;
    save: () => Promise<void>;
  } | null;
};

export type FileViewRenderer = {
  id: string;
  match: (file: FileViewFile, content: FileViewContent) => boolean;
  component: Component<FileViewRendererProps>;
  /** Text renderers that support the edit affordance when `save` is present. */
  editable?: boolean;
};

const codeLanguage = (path: string): CodeDisplayLanguage => {
  const extension = fileViewExtension(path);
  if (extension === "ts" || extension === "mts" || extension === "cts") return "ts";
  if (extension === "tsx") return "tsx";
  if (extension === "js" || extension === "mjs" || extension === "cjs") return "js";
  if (extension === "jsx") return "jsx";
  if (extension === "md" || extension === "markdown") return "md";
  return "text";
};

const isMarkdown = (file: FileViewFile, content: FileViewContent) =>
  content.encoding === "utf8" && getFileViewPreviewKind({ ...file, mediaType: content.mediaType || file.mediaType }) === "markdown";

/** Rendered previews hide a leading YAML frontmatter block — it's metadata, not content. */
const stripFrontmatter = (text: string): string => {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text.trimStart());
  return match ? text.trimStart().slice(match[0].length) : text;
};

/** Quiet document surface — same family as the markdown editor's paper look. */
const previewPanelClass = "rounded-md border border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-900";

/** Icon-only action, IDE style — sits in the floating top-right cluster of previews. */
function OverlayAction(props: { icon: string; title: string; onClick?: () => void; href?: string; download?: string }) {
  const classes =
    "inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/85 text-secondary backdrop-blur transition-colors hover:text-primary dark:bg-zinc-900/85 [box-shadow:var(--ui-control-bevel)]";
  return (
    <Show
      when={props.href}
      fallback={
        <button type="button" class={classes} title={props.title} aria-label={props.title} onClick={props.onClick}>
          <i class={`ti ${props.icon} text-sm`} aria-hidden="true" />
        </button>
      }
    >
      {(href) => (
        <a class={classes} href={href()} download={props.download ?? ""} title={props.title} aria-label={props.title}>
          <i class={`ti ${props.icon} text-sm`} aria-hidden="true" />
          <span class="sr-only">{props.title}</span>
        </a>
      )}
    </Show>
  );
}

/** Scrollable preview panel with the floating action cluster overlaid top-right. */
function OverlayPanel(props: { actions?: JSX.Element; children: JSX.Element }) {
  return (
    <div class="relative flex min-h-0 flex-1 flex-col">
      <div class={`min-h-0 flex-1 overflow-auto ${previewPanelClass}`}>{props.children}</div>
      <Show when={props.actions}>
        <div class="absolute right-2 top-2 z-10 flex items-center gap-1">{props.actions}</div>
      </Show>
    </div>
  );
}

const downloadAction = (props: FileViewRendererProps): JSX.Element => (
  <Show when={props.downloadHref}>
    {(href) => (
      <OverlayAction
        icon="ti-download"
        title="Download"
        href={href()}
        download={props.file.path.slice(props.file.path.lastIndexOf("/") + 1)}
      />
    )}
  </Show>
);

/** Toolbar-styled icon button (matches .md-editor-tool). */
function EditorToolButton(props: { icon: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      class="md-editor-tool"
      title={props.title}
      aria-label={props.title}
      tabIndex={-1}
      disabled={props.disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      <i class={props.icon} />
    </button>
  );
}

// ── Built-in renderers ──────────────────────────────────────────────────────

function MarkdownRenderer(props: FileViewRendererProps) {
  const [editing, setEditing] = createSignal(false);
  return (
    <Show
      when={props.editor && editing()}
      fallback={
        <OverlayPanel
          actions={
            <>
              <Show when={props.editor}>
                <OverlayAction icon="ti-pencil" title="Edit" onClick={() => setEditing(true)} />
              </Show>
              {downloadAction(props)}
            </>
          }
        >
          <div class="p-4">
            <MarkdownView html={markdown.renderSync(stripFrontmatter(props.editor?.draft() ?? props.content.content))} smallHeadings />
          </div>
        </OverlayPanel>
      }
    >
      {(_) => {
        const editor = props.editor!;
        return (
          <div class="flex min-h-0 min-w-0 flex-1 flex-col">
            <MarkdownEditor
              fill
              value={editor.draft}
              onInput={editor.setDraft}
              showStats={false}
              onSave={() => void editor.save()}
              saveDisabled={() => !editor.dirty()}
              saving={editor.saving}
              toolbarTrailing={<EditorToolButton icon="ti ti-eye" title="Preview" onClick={() => setEditing(false)} />}
            />
          </div>
        );
      }}
    </Show>
  );
}

function TextRenderer(props: FileViewRendererProps) {
  return (
    <Show
      when={props.editor}
      fallback={
        <OverlayPanel actions={downloadAction(props)}>
          <CodeDisplay code={props.content.content} language={codeLanguage(props.file.path)} />
        </OverlayPanel>
      }
    >
      {(editor) => (
        // Same chrome as the markdown editor: toolbar strip + focusable surface.
        <div
          class="md-editor"
          data-fill="true"
          role="group"
          aria-label="Text editor"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
              event.preventDefault();
              if (editor().dirty() && !editor().saving()) void editor().save();
            }
          }}
        >
          {/* No formatting tools here — the divider under an actions-only bar reads lost. */}
          <div class="md-editor-toolbar" style={{ "border-bottom": "none" }}>
            <span class="px-1 text-[10px] font-medium uppercase tracking-wide text-dimmed">{codeLanguage(props.file.path)}</span>
            <span class="ml-auto inline-flex items-center gap-0.5">
              <Show when={props.downloadHref}>
                {(href) => (
                  <a
                    class="md-editor-tool"
                    href={href()}
                    download={props.file.path.slice(props.file.path.lastIndexOf("/") + 1)}
                    title="Download"
                    aria-label="Download"
                  >
                    <i class="ti ti-download" />
                  </a>
                )}
              </Show>
              <EditorToolButton
                icon={editor().saving() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"}
                title="Save (Ctrl/Cmd+S)"
                disabled={!editor().dirty() || editor().saving()}
                onClick={() => void editor().save()}
              />
            </span>
          </div>
          <div class="md-editor-surface">
            <textarea
              class="h-full w-full resize-none bg-transparent p-3 font-mono text-xs leading-5 text-primary outline-none"
              value={editor().draft()}
              spellcheck={false}
              onInput={(event) => editor().setDraft(event.currentTarget.value)}
            />
          </div>
        </div>
      )}
    </Show>
  );
}

function JsonRenderer(props: FileViewRendererProps) {
  const parsed = createMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(props.content.content) as unknown };
    } catch {
      return { ok: false as const };
    }
  });

  return (
    <OverlayPanel actions={downloadAction(props)}>
      <div class="p-4">
        <Show when={parsed().ok} fallback={<CodeDisplay code={props.content.content} language="text" />}>
          <StructuredDataPreview data={parsed().ok ? parsed().value : null} maxRows={200} />
        </Show>
      </div>
    </OverlayPanel>
  );
}

function DelimitedTextRenderer(props: FileViewRendererProps) {
  const delimiter = () =>
    fileViewExtension(props.file.path) === "tsv" || props.content.mediaType === "text/tab-separated-values" ? "\t" : ",";
  const preview = createMemo(() => parseDelimitedText(props.content.content, delimiter()));
  const headers = createMemo(() => preview().rows[0] ?? []);
  const rows = createMemo(() => preview().rows.slice(1));

  return (
    <OverlayPanel actions={downloadAction(props)}>
      <Show
        when={headers().length > 0}
        fallback={<Placeholder icon="ti ti-table" title="Empty file" description="This delimited file contains no rows." />}
      >
        <div class="min-w-max">
          <table class="w-full text-left text-xs">
            <thead class="sticky top-0 z-[1] bg-[var(--ui-data-header)] text-secondary">
              <tr>
                <For each={headers()}>
                  {(header, index) => (
                    <th scope="col" class="max-w-72 px-3 py-2 font-semibold">
                      <span class="block truncate">{header || `Column ${index() + 1}`}</span>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(row) => (
                  <tr class="hover:bg-[var(--ui-data-row-hover)]">
                    <For each={headers()}>
                      {(_, index) => <td class="max-w-72 px-3 py-2 align-top text-secondary">{row[index()] ?? ""}</td>}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={preview().truncated}>
            <p class="px-3 py-2 text-xs text-dimmed">Preview limited to 200 data rows and 50 columns.</p>
          </Show>
        </div>
      </Show>
    </OverlayPanel>
  );
}

const mediaSource = (props: FileViewRendererProps): string =>
  props.previewHref ?? `data:${props.content.mediaType};base64,${props.content.content}`;

function ImageRenderer(props: FileViewRendererProps) {
  return (
    <OverlayPanel actions={downloadAction(props)}>
      <div class="grid h-full place-items-center p-3">
        <img src={mediaSource(props)} alt={props.file.path} class="max-h-full max-w-full rounded-md object-contain" />
      </div>
    </OverlayPanel>
  );
}

function PdfRenderer(props: FileViewRendererProps) {
  const href = () => props.previewHref ?? props.downloadHref;
  return (
    <Show
      when={href()}
      fallback={<Placeholder icon="ti ti-file-type-pdf" title="PDF" description="No inline preview available for this source." />}
    >
      {(href) => <object data={href()} type="application/pdf" class="min-h-0 w-full flex-1 rounded-md" aria-label={props.file.path} />}
    </Show>
  );
}

function AudioRenderer(props: FileViewRendererProps) {
  return (
    <OverlayPanel actions={downloadAction(props)}>
      <div class="grid h-full min-h-48 place-items-center p-6">
        <audio class="w-full max-w-2xl" controls preload="metadata" src={mediaSource(props)} aria-label={props.file.path}>
          Your browser does not support audio playback.
        </audio>
      </div>
    </OverlayPanel>
  );
}

function VideoRenderer(props: FileViewRendererProps) {
  return (
    <OverlayPanel actions={downloadAction(props)}>
      <div class="grid h-full place-items-center bg-black p-3">
        <video
          class="max-h-full max-w-full rounded-md"
          controls
          preload="metadata"
          playsinline
          src={mediaSource(props)}
          aria-label={props.file.path}
        >
          Your browser does not support video playback.
        </video>
      </div>
    </OverlayPanel>
  );
}

function BinaryRenderer(props: FileViewRendererProps) {
  return (
    <Placeholder
      icon="ti ti-file-unknown"
      title="No preview"
      description={props.content.mediaType || "Binary file"}
      action={
        <Show when={props.downloadHref}>
          {(href) => (
            <a class="btn-input btn-input-sm" href={href()} download="">
              <i class="ti ti-download" aria-hidden="true" />
              Download
            </a>
          )}
        </Show>
      }
    />
  );
}

const BUILTIN_RENDERERS: FileViewRenderer[] = [
  { id: "markdown", match: isMarkdown, component: MarkdownRenderer, editable: true },
  {
    id: "image",
    match: (file, content) => getFileViewPreviewKind({ ...file, mediaType: content.mediaType || file.mediaType }) === "image",
    component: ImageRenderer,
  },
  {
    id: "pdf",
    match: (file, content) => getFileViewPreviewKind({ ...file, mediaType: content.mediaType || file.mediaType }) === "pdf",
    component: PdfRenderer,
  },
  {
    id: "json",
    match: (file, content) =>
      content.encoding === "utf8" && getFileViewPreviewKind({ ...file, mediaType: content.mediaType || file.mediaType }) === "json",
    component: JsonRenderer,
  },
  {
    id: "delimited-text",
    match: (file, content) =>
      content.encoding === "utf8" &&
      getFileViewPreviewKind({ ...file, mediaType: content.mediaType || file.mediaType }) === "delimited-text",
    component: DelimitedTextRenderer,
  },
  {
    id: "audio",
    match: (file, content) => getFileViewPreviewKind({ ...file, mediaType: content.mediaType || file.mediaType }) === "audio",
    component: AudioRenderer,
  },
  {
    id: "video",
    match: (file, content) => getFileViewPreviewKind({ ...file, mediaType: content.mediaType || file.mediaType }) === "video",
    component: VideoRenderer,
  },
  { id: "text", match: (_file, content) => content.encoding === "utf8", component: TextRenderer, editable: true },
  { id: "binary", match: () => true, component: BinaryRenderer },
];

const customRenderers: FileViewRenderer[] = [];

/** Register an app-specific renderer — matched before the built-ins. */
export const registerFileViewRenderer = (renderer: FileViewRenderer): void => {
  customRenderers.push(renderer);
};

// ── Component ───────────────────────────────────────────────────────────────

export const formatFileViewSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function FileView(props: FileViewProps) {
  const [draft, setDraft] = createSignal("");
  const [dirty, setDirty] = createSignal(false);
  const saveMutation = mutation.create<{ path: string; content: string }, { path: string; content: string }>({
    mutation: async (input) => {
      await props.save!(input.content);
      return input;
    },
    onSuccess: (saved) => {
      if (props.file.path === saved.path && draft() === saved.content) setDirty(false);
      toast.success("File saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const browserPreviewContent = createMemo<FileViewContent | null>(() => {
    const kind = getFileViewPreviewKind(props.file);
    if (kind !== "image" && kind !== "pdf" && kind !== "audio" && kind !== "video") return null;
    const href = props.previewHref ?? (kind === "pdf" ? props.downloadHref : null);
    if (!href) return null;

    const candidate: FileViewContent = {
      encoding: "base64",
      content: "",
      mediaType: props.file.mediaType ?? "application/octet-stream",
    };
    return customRenderers.some((renderer) => renderer.match(props.file, candidate)) ? null : candidate;
  });
  const [content] = createResource(
    () => (browserPreviewContent() ? null : props.file.path),
    async () => {
      saveMutation.abort();
      const loaded = await props.load();
      setDraft(loaded.encoding === "utf8" ? loaded.content : "");
      setDirty(false);
      return loaded;
    },
  );
  const resolvedContent = createMemo(() => browserPreviewContent() ?? content());

  const renderer = createMemo(() => {
    const loaded = resolvedContent();
    if (!loaded) return null;
    return [...customRenderers, ...BUILTIN_RENDERERS].find((candidate) => candidate.match(props.file, loaded)) ?? null;
  });

  const save = async () => {
    if (!props.save || saveMutation.loading()) return;
    await saveMutation.mutate({ path: props.file.path, content: draft() });
  };

  const editor = () =>
    props.save && renderer()?.editable && resolvedContent()?.encoding === "utf8"
      ? {
          draft,
          setDraft: (value: string) => {
            setDraft(value);
            setDirty(true);
          },
          dirty,
          saving: saveMutation.loading,
          save,
        }
      : null;

  return (
    <div class={`flex min-h-0 min-w-0 flex-1 flex-col ${props.class ?? ""}`}>
      <Switch>
        <Match when={content.loading}>
          <Placeholder icon="ti ti-loader-2" title="Loading…" />
        </Match>
        <Match when={content.error}>
          <Placeholder icon="ti ti-alert-circle" title="Failed to load file" description={String(content.error?.message ?? "")} />
        </Match>
        <Match when={resolvedContent() && renderer()}>
          {(active) => {
            const Renderer = active().component;
            return (
              <Renderer
                file={props.file}
                content={resolvedContent()!}
                previewHref={props.previewHref ?? null}
                downloadHref={props.downloadHref ?? null}
                editor={editor()}
              />
            );
          }}
        </Match>
      </Switch>
    </div>
  );
}
