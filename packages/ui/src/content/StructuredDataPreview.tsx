import { createMemo, createSignal, For, Show } from "solid-js";
import CopyButton from "../actions/CopyButton";

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
    <div class={["k2b-content-structured-data", props.class].filter(Boolean).join(" ")}>
      <Show when={props.title}>{(title) => <h2 class="k2b-content-structured-data__title">{title()}</h2>}</Show>

      <Show
        when={!showRaw()}
        fallback={
          <div class="k2b-content-structured-data__surface" data-mode="raw">
            <pre>{raw()}</pre>
            <Show when={props.copy !== false}>
              <div class="k2b-content-structured-data__copy">
                <CopyButton text={raw()} label="Copy" />
              </div>
            </Show>
          </div>
        }
      >
        <div class="k2b-content-structured-data__surface">
          <Show when={hasData()} fallback={<p class="k2b-content-structured-data__empty">{props.empty ?? "No data."}</p>}>
            <div class="k2b-content-structured-data__rows">
              <For each={visibleRows()}>
                {(row) => {
                  const complex = typeof row.value === "object" && row.value !== null;
                  return (
                    <>
                      <span class="k2b-content-structured-data__key" title={row.key}>
                        {row.key}
                      </span>
                      <span class="k2b-content-structured-data__value" data-complex={complex ? "true" : undefined}>
                        {formatInlineValue(row.value)}
                      </span>
                    </>
                  );
                }}
              </For>
            </div>
            <Show when={hiddenCount() > 0}>
              <p class="k2b-content-structured-data__hidden">
                {hiddenCount()} more row{hiddenCount() === 1 ? "" : "s"} hidden.
              </p>
            </Show>
          </Show>
        </div>
      </Show>

      <div class="k2b-content-structured-data__footer">
        <Show when={hasData()}>
          <button type="button" class="k2b-content-structured-data__action" onClick={() => setMode(showRaw() ? "formatted" : "raw")}>
            {showRaw() ? "View formatted" : "View raw"}
          </button>
        </Show>
      </div>
    </div>
  );
}
