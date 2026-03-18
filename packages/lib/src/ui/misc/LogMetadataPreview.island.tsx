import { createMemo, createSignal } from "solid-js";

type MetadataValue = Record<string, unknown> | string | null;

type Props = {
  data: MetadataValue;
};

const toPreviewText = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => toPreviewText(item)).filter(Boolean).join(" · ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 4)
      .map(([key, entry]) => {
        const text = toPreviewText(entry);
        const short = text.length > 40 ? `${text.slice(0, 40)}...` : text;
        return short ? `${key}=${short}` : key;
      })
      .filter(Boolean)
      .join("  ");
  }
  return JSON.stringify(value);
};

const parseData = (data: MetadataValue): unknown => {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
};

export default function LogMetadataPreview(props: Props) {
  const [expanded, setExpanded] = createSignal(false);
  const parsed = createMemo(() => parseData(props.data));
  const preview = createMemo(() => toPreviewText(parsed()));
  const full = createMemo(() => {
    const value = parsed();
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  });

  return (
    <div class="mt-1">
      {expanded() ? (
        <button type="button" class="w-full text-left rounded-xl" onClick={() => setExpanded(false)} aria-label="Collapse metadata preview">
          <pre class="max-h-60 overflow-auto rounded-xl bg-zinc-100 p-2 text-xs text-dimmed dark:bg-zinc-800">{full()}</pre>
        </button>
      ) : (
        <button
          type="button"
          class="max-w-full cursor-pointer text-left text-xs text-dimmed transition-colors hover:text-primary"
          onClick={() => setExpanded(true)}
          aria-label="Expand metadata preview"
        >
          <span class="line-clamp-1 break-all">{preview() || "Show metadata"}</span>
        </button>
      )}
    </div>
  );
}
