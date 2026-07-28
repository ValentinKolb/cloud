import { highlight } from "@k2b/stdlib";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { CopyButton } from "../actions";

export type CodeDisplayProps = {
  code: string;
  language?: "text" | "code" | "sql" | "shell";
  label?: string;
  title?: string;
  copy?: boolean;
  lineNumbers?: boolean;
  class?: string;
};

export function CodeDisplay(props: CodeDisplayProps): JSX.Element {
  const lineNumbers = () => props.lineNumbers ?? true;
  const copy = () => props.copy ?? true;
  const renderedLines = () => {
    const render = (line: string) => {
      if (props.language === "sql") return highlight.presets.sql(line);
      if (props.language === "shell") return highlight.presets.shell(line);
      if (props.language === "code") return highlight.presets.code(line);
      return highlight.escape(line);
    };
    return props.code.split("\n").map(render);
  };
  return (
    <figure class={`k2b-code-display ${props.class ?? ""}`} data-lines={lineNumbers() ? "true" : undefined}>
      <Show when={props.title || props.label || copy()}>
        <figcaption>
          <span>{props.title ?? props.label}</span>
          <Show when={copy()}>
            <CopyButton value={props.code} label="Copy code" />
          </Show>
        </figcaption>
      </Show>
      <pre>
        <For each={renderedLines()}>
          {(line, index) => (
            <span class="k2b-code-display__line">
              <Show when={lineNumbers()}>
                <span class="k2b-code-display__number" aria-hidden="true">
                  {index() + 1}
                </span>
              </Show>
              <code innerHTML={line || " "} />
            </span>
          )}
        </For>
      </pre>
    </figure>
  );
}

export type MarkdownViewProps = {
  /** Trusted, pre-rendered HTML. Sanitize untrusted Markdown before passing it here. */
  html: string;
  class?: string;
  label?: string;
  smallHeadings?: boolean;
};

export function MarkdownView(props: MarkdownViewProps): JSX.Element {
  return (
    <article
      class={`k2b-markdown ${props.class ?? ""}`}
      data-small-headings={props.smallHeadings ? "true" : undefined}
      aria-label={props.label}
      innerHTML={props.html}
    />
  );
}

export type StructuredDataPreviewMode = "formatted" | "raw";
export type StructuredDataPreviewProps = {
  value?: unknown;
  data?: unknown;
  label?: string;
  title?: string;
  defaultMode?: StructuredDataPreviewMode;
  copy?: boolean;
  empty?: string;
  maxRows?: number;
  class?: string;
};

export function StructuredDataPreview(props: StructuredDataPreviewProps): JSX.Element {
  const [mode, setMode] = createSignal<StructuredDataPreviewMode>(props.defaultMode ?? "formatted");
  const value = () => (props.data === undefined ? props.value : props.data);
  const rows = createMemo(() => {
    const data = value();
    if (Array.isArray(data)) return data.map((entry, index) => ({ key: String(index), value: entry }));
    if (data && typeof data === "object") return Object.entries(data as Record<string, unknown>).map(([key, entry]) => ({ key, value: entry }));
    if (data === null || data === undefined) return [];
    return [{ key: "value", value: data }];
  });
  const visibleRows = () => rows().slice(0, props.maxRows ?? rows().length);
  const raw = () => JSON.stringify(value() ?? null, null, 2);
  const inline = (entry: unknown) => {
    if (entry === null || entry === undefined) return "null";
    return typeof entry === "object" ? JSON.stringify(entry) : String(entry);
  };

  return (
    <section class={`k2b-structured-data ${props.class ?? ""}`}>
      <Show when={props.title ?? props.label}>{(title) => <h3>{title()}</h3>}</Show>
      <Show
        when={mode() === "formatted"}
        fallback={
          <div class="k2b-structured-data__raw">
            <pre>{raw()}</pre>
            <Show when={props.copy !== false}>
              <CopyButton value={raw()} label="Copy data" />
            </Show>
          </div>
        }
      >
        <Show when={rows().length > 0} fallback={<p class="k2b-structured-data__empty">{props.empty ?? "No data."}</p>}>
          <dl>
            <For each={visibleRows()}>
              {(row) => (
                <>
                  <dt title={row.key}>{row.key}</dt>
                  <dd data-complex={typeof row.value === "object" && row.value !== null ? "true" : undefined}>{inline(row.value)}</dd>
                </>
              )}
            </For>
          </dl>
          <Show when={rows().length > visibleRows().length}>
            <p class="k2b-structured-data__more">{rows().length - visibleRows().length} more rows hidden.</p>
          </Show>
        </Show>
      </Show>
      <Show when={rows().length > 0}>
        <button type="button" class="k2b-structured-data__toggle" onClick={() => setMode(mode() === "raw" ? "formatted" : "raw")}>
          {mode() === "raw" ? "View formatted" : "View raw"}
        </button>
      </Show>
    </section>
  );
}
