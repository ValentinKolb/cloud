import { createMemo, createSignal, For, Show } from "solid-js";
import CopyButton from "./CopyButton";

export type StructuredDataPreviewMode = "formatted" | "raw";

export type StructuredDataPreviewProps = {
  title?: string;
  data: unknown;
  defaultMode?: StructuredDataPreviewMode;
  copy?: boolean;
  empty?: string;
  maxRows?: number;
  class?: string;
};

type Row = {
  key: string;
  value: unknown;
};

const toRows = (data: unknown): Row[] => {
  if (Array.isArray(data)) return data.map((value, index) => ({ key: String(index), value }));
  if (data && typeof data === "object") return Object.entries(data as Record<string, unknown>).map(([key, value]) => ({ key, value }));
  if (data === null || data === undefined) return [];
  return [{ key: "value", value: data }];
};

const formatInlineValue = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

const formatJson = (data: unknown): string => JSON.stringify(data ?? null, null, 2);

export default function StructuredDataPreview(props: StructuredDataPreviewProps) {
  const [mode, setMode] = createSignal<StructuredDataPreviewMode>(props.defaultMode ?? "formatted");
  const rows = createMemo(() => toRows(props.data));
  const visibleRows = createMemo(() => rows().slice(0, props.maxRows ?? rows().length));
  const hiddenCount = createMemo(() => Math.max(0, rows().length - visibleRows().length));
  const raw = createMemo(() => formatJson(props.data));
  const hasData = createMemo(() => rows().length > 0);
  const showRaw = createMemo(() => mode() === "raw");

  return (
    <div class={["flex flex-col gap-2", props.class].filter(Boolean).join(" ")}>
      <Show when={props.title}>{(title) => <h3 class="text-xs font-semibold uppercase tracking-wider text-secondary">{title()}</h3>}</Show>

      <Show
        when={!showRaw()}
        fallback={
          <div class="relative rounded-lg bg-zinc-100 px-3 py-2 text-secondary dark:bg-zinc-900/80">
            <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-all pr-16 font-mono text-[11px] leading-relaxed">{raw()}</pre>
            <Show when={props.copy !== false}>
              <div class="absolute right-2 top-2">
                <CopyButton text={raw()} label="Copy" class="text-[11px] text-dimmed transition-colors hover:text-secondary" />
              </div>
            </Show>
          </div>
        }
      >
        <div class="rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-900/80">
          <Show when={hasData()} fallback={<p class="text-xs text-dimmed">{props.empty ?? "No data."}</p>}>
            <div class="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-xs">
              <For each={visibleRows()}>
                {(row) => {
                  const complex = typeof row.value === "object" && row.value !== null;
                  return (
                    <>
                      <span class="min-w-0 truncate font-medium text-dimmed" title={row.key}>
                        {row.key}
                      </span>
                      <span class={`min-w-0 break-all text-secondary ${complex ? "font-mono text-[11px]" : ""}`}>
                        {formatInlineValue(row.value)}
                      </span>
                    </>
                  );
                }}
              </For>
            </div>
            <Show when={hiddenCount() > 0}>
              <p class="mt-2 text-[11px] text-dimmed">
                {hiddenCount()} more row{hiddenCount() === 1 ? "" : "s"} hidden.
              </p>
            </Show>
          </Show>
        </div>
      </Show>

      <div class="flex items-center gap-2">
        <Show when={hasData()}>
          <button
            type="button"
            class="text-[11px] text-dimmed transition-colors hover:text-secondary"
            onClick={() => setMode(showRaw() ? "formatted" : "raw")}
          >
            {showRaw() ? "View formatted" : "View raw"}
          </button>
        </Show>
      </div>
    </div>
  );
}
