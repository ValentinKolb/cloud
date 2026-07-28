import { fileIcons } from "@k2b/stdlib";
import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show, Switch, Match } from "solid-js";
import { CodeDisplay, MarkdownView, StructuredDataPreview } from "./ContentViews";

export type FileItem = {
  id: string;
  name: string;
  type: "file" | "directory";
  mimeType?: string;
  size?: number;
  children?: readonly FileItem[];
  loading?: boolean;
};
export type FileTreeProps = {
  items: readonly FileItem[];
  selectedId?: string;
  expandedIds?: readonly string[];
  defaultExpandedIds?: readonly string[];
  onExpandedChange?: (ids: readonly string[]) => void;
  onSelect?: (item: FileItem) => void;
  onOpen?: (item: FileItem) => void;
  empty?: JSX.Element;
  class?: string;
};

const TreeBranch = (props: FileTreeProps & {
  items: readonly FileItem[];
  depth: number;
  expanded: () => Set<string>;
  toggle: (item: FileItem) => void;
}): JSX.Element => (
  <ul role={props.depth === 0 ? "tree" : "group"}>
    <For each={props.items}>
      {(item) => {
        const open = () => props.expanded().has(item.id);
        return (
          <li role="treeitem" aria-selected={item.id === props.selectedId} aria-expanded={item.type === "directory" ? open() : undefined}>
            <button
              type="button"
              data-selected={item.id === props.selectedId ? "true" : undefined}
              style={{ "--k2b-file-depth": String(props.depth) }}
              onClick={() => {
                if (item.type === "directory") props.toggle(item);
                props.onSelect?.(item);
              }}
              onDblClick={() => props.onOpen?.(item)}
              onKeyDown={(event) => {
                if (item.type !== "directory") return;
                if (event.key === "ArrowRight" && !open()) { event.preventDefault(); props.toggle(item); }
                if (event.key === "ArrowLeft" && open()) { event.preventDefault(); props.toggle(item); }
              }}
            >
              <Show when={item.type === "directory"}>
                <i class={`ti ti-chevron-${open() ? "down" : "right"} k2b-file-tree__chevron`} aria-hidden="true" />
              </Show>
              <i class={item.type === "directory" && open() ? "ti ti-folder-open" : fileIcons.getFileIcon(item)} aria-hidden="true" />
              <span>{item.name}</span>
              <Show when={item.loading}><i class="ti ti-loader-2 k2b-spin" aria-label="Loading" /></Show>
            </button>
            <Show when={item.type === "directory" && open() && item.children?.length}>
              <TreeBranch {...props} items={item.children ?? []} depth={props.depth + 1} />
            </Show>
          </li>
        );
      }}
    </For>
  </ul>
);

export function FileTree(props: FileTreeProps): JSX.Element {
  const [internal, setInternal] = createSignal(new Set(props.defaultExpandedIds ?? []));
  const expanded = () => new Set(props.expandedIds ?? [...internal()]);
  const toggle = (item: FileItem) => {
    const next = expanded();
    next.has(item.id) ? next.delete(item.id) : next.add(item.id);
    if (props.expandedIds === undefined) setInternal(next);
    props.onExpandedChange?.([...next]);
  };
  return (
    <div class={`k2b-file-tree ${props.class ?? ""}`}>
      <Show when={props.items.length > 0} fallback={<div class="k2b-file-tree__empty">{props.empty ?? "No files"}</div>}>
        <TreeBranch {...props} depth={0} expanded={expanded} toggle={toggle} />
      </Show>
    </div>
  );
}

export type FileBrowserProps = FileTreeProps & {
  title?: string;
  subtitle?: string;
  toolbar?: JSX.Element;
  preview?: JSX.Element;
  children?: JSX.Element;
};
export function FileBrowser(props: FileBrowserProps): JSX.Element {
  return (
    <section class="k2b-file-browser" aria-label={props.title ?? "Files"}>
      <header>
        <div><strong>{props.title ?? "Files"}</strong><Show when={props.subtitle}><small>{props.subtitle}</small></Show></div>
        <Show when={props.toolbar}>{props.toolbar}</Show>
      </header>
      <div class="k2b-file-browser__body">
        <FileTree {...props} />
        <div class="k2b-file-browser__preview">{props.preview ?? props.children ?? <span>Select a file to preview it</span>}</div>
      </div>
    </section>
  );
}

export type FileViewProps = {
  name: string;
  mimeType?: string;
  src?: string;
  text?: string;
  /** Trusted, pre-rendered HTML. Sanitize untrusted content in the consumer. */
  html?: string;
  data?: unknown;
  loading?: boolean;
  error?: JSX.Element;
  downloadHref?: string;
  class?: string;
  empty?: JSX.Element;
};
export function FileView(props: FileViewProps): JSX.Element {
  const category = () => fileIcons.getFileCategory({ name: props.name, type: "file", mimeType: props.mimeType });
  const media = () => props.mimeType?.split("/")[0];
  return (
    <section class={`k2b-file-view ${props.class ?? ""}`} aria-label={`Preview ${props.name}`}>
      <Show when={props.downloadHref}><a class="k2b-file-view__download" href={props.downloadHref} download={props.name}><i class="ti ti-download" aria-hidden="true" /> Download</a></Show>
      <Switch>
        <Match when={props.loading}><div class="k2b-file-view__state" role="status"><i class="ti ti-loader-2 k2b-spin" /> Loading…</div></Match>
        <Match when={props.error}><div class="k2b-file-view__state" role="alert">{props.error}</div></Match>
        <Match when={category() === "image" && props.src}><img src={props.src} alt={props.name} /></Match>
        <Match when={category() === "pdf" && props.src}><PdfPreview src={props.src!} title={props.name} /></Match>
        <Match when={media() === "audio" && props.src}><audio controls preload="metadata" src={props.src} aria-label={props.name} /></Match>
        <Match when={media() === "video" && props.src}><video controls preload="metadata" playsinline src={props.src} aria-label={props.name} /></Match>
        <Match when={props.html}><MarkdownView html={props.html!} /></Match>
        <Match when={props.text !== undefined}><CodeDisplay code={props.text ?? ""} language={category() === "code" ? "code" : "text"} label={props.name} copy /></Match>
        <Match when={props.data !== undefined}><StructuredDataPreview value={props.data} label={props.name} /></Match>
        <Match when={true}><div class="k2b-file-view__state">{props.empty ?? "Preview unavailable"}</div></Match>
      </Switch>
    </section>
  );
}

export type PdfPreviewRequest = () => Promise<Response | Blob>;
export type PdfPreviewProps = {
  src?: string;
  request?: PdfPreviewRequest;
  title?: string;
  class?: string;
  fallback?: JSX.Element;
};
export function PdfPreview(props: PdfPreviewProps): JSX.Element {
  const [generatedSrc, setGeneratedSrc] = createSignal<string>();
  const [error, setError] = createSignal<unknown>();
  onMount(() => {
    if (!props.request) return;
    let active = true;
    void props.request().then(async (value) => {
      const blob = value instanceof Response ? await value.blob() : value;
      if (active) setGeneratedSrc(URL.createObjectURL(blob));
    }).catch((reason) => active && setError(reason));
    onCleanup(() => {
      active = false;
      const url = generatedSrc();
      if (url) URL.revokeObjectURL(url);
    });
  });
  const source = () => props.src ?? generatedSrc();
  return (
    <Show when={source()} fallback={<div class="k2b-pdf-preview__state" role={error() ? "alert" : "status"}>{error() ? props.fallback ?? "PDF preview failed" : "Loading PDF…"}</div>}>
      {(src) => <object class={`k2b-pdf-preview ${props.class ?? ""}`} data={src()} type="application/pdf" aria-label={props.title ?? "PDF preview"}><a href={src()}>Open {props.title ?? "PDF"}</a></object>}
    </Show>
  );
}

export type LightboxImage = { src: string; alt: string; caption?: JSX.Element };
export type LightboxProps = {
  images?: readonly LightboxImage[];
  src?: string;
  alt?: string;
  caption?: JSX.Element;
  index?: number;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onIndexChange?: (index: number) => void;
};
export function Lightbox(props: LightboxProps): JSX.Element {
  let root: HTMLDivElement | undefined;
  let previousFocus: HTMLElement | null = null;
  let wasOpen = false;
  const images = () => props.images ?? (props.src ? [{ src: props.src, alt: props.alt ?? "", caption: props.caption }] : []);
  const index = () => Math.max(0, Math.min(images().length - 1, props.index ?? 0));
  const move = (delta: number) => {
    if (images().length < 2) return;
    props.onIndexChange?.((index() + delta + images().length) % images().length);
  };
  createEffect(() => {
    if (props.open && !wasOpen) {
      previousFocus = document.activeElement as HTMLElement | null;
      queueMicrotask(() => root?.focus());
    }
    if (!props.open && wasOpen) previousFocus?.focus();
    wasOpen = props.open;
  });
  onCleanup(() => previousFocus?.focus());
  return (
    <Show when={props.open && images().length > 0}>
      <div
        ref={root}
        class="k2b-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label="Image preview"
        tabindex="-1"
        onClick={(event) => event.target === event.currentTarget && props.onOpenChange?.(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onOpenChange?.(false);
          if (event.key === "ArrowLeft") move(-1);
          if (event.key === "ArrowRight") move(1);
        }}
      >
        <button type="button" class="k2b-lightbox__close" aria-label="Close" onClick={() => props.onOpenChange?.(false)}><i class="ti ti-x" /></button>
        <Show when={images().length > 1}>
          <button type="button" class="k2b-lightbox__previous" aria-label="Previous image" onClick={() => move(-1)}><i class="ti ti-chevron-left" /></button>
          <button type="button" class="k2b-lightbox__next" aria-label="Next image" onClick={() => move(1)}><i class="ti ti-chevron-right" /></button>
        </Show>
        <figure>
          <img src={images()[index()]!.src} alt={images()[index()]!.alt} />
          <Show when={images()[index()]!.caption}><figcaption>{images()[index()]!.caption}</figcaption></Show>
        </figure>
      </div>
    </Show>
  );
}
