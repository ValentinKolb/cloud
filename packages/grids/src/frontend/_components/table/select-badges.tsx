import type { JSX } from "solid-js";
import { selectBadgeItems, selectBadgeStyle } from "./select-badge-utils";

export function SelectValueBadges(props: { value: unknown; type: string; fieldConfig?: Record<string, unknown>; empty?: JSX.Element }) {
  const items = () => selectBadgeItems(props.value, props.type, props.fieldConfig);
  return (
    <span class="inline-flex min-w-0 flex-wrap items-center gap-1">
      {items().length === 0
        ? (props.empty ?? "")
        : items().map((item) => (
            <span
              class="badge max-w-full shrink-0 border border-zinc-200 bg-zinc-100 font-medium leading-5 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              classList={{ "opacity-75": !item.known }}
              style={selectBadgeStyle(item.color) as JSX.CSSProperties}
              title={item.known ? item.id : `Unknown option: ${item.id}`}
            >
              <span class="truncate">{item.label}</span>
            </span>
          ))}
    </span>
  );
}
