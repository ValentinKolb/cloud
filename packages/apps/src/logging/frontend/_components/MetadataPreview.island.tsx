import { createSignal, createMemo } from "solid-js";

type Props = {
  data: Record<string, unknown> | string;
};

/** Compact key=value preview, click to expand full formatted JSON. */
const MetadataPreview = (props: Props) => {
  const [expanded, setExpanded] = createSignal(false);

  const parsed = createMemo(() => {
    if (typeof props.data === "string") {
      try {
        return JSON.parse(props.data) as Record<string, unknown>;
      } catch {
        return { raw: props.data };
      }
    }
    return props.data;
  });

  const preview = () => {
    const entries = Object.entries(parsed());
    return entries
      .map(([k, v]) => {
        const val = typeof v === "string" ? v : JSON.stringify(v);
        const short = val && val.length > 40 ? val.slice(0, 40) + "..." : val;
        return `${k}=${short}`;
      })
      .join("  ");
  };

  return (
    <div class="mt-0.5">
      {expanded() ? (
        <button type="button" class="w-full text-left rounded" onClick={() => setExpanded(false)} aria-label="Collapse metadata preview">
          <pre class="text-xs text-dimmed font-mono whitespace-pre-wrap bg-zinc-100 dark:bg-zinc-800 rounded p-2 cursor-pointer max-h-60 overflow-auto">
            {JSON.stringify(parsed(), null, 2)}
          </pre>
        </button>
      ) : (
        <button
          type="button"
          class="text-xs text-dimmed font-mono line-clamp-1 hover:text-primary cursor-pointer text-left"
          onClick={() => setExpanded(true)}
          aria-label="Expand metadata preview"
        >
          {preview()}
        </button>
      )}
    </div>
  );
};

export default MetadataPreview;
