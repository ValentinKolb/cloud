import type { JSX } from "solid-js";
import { type SelectBadgeItem, selectBadgeStyle } from "./select-badge-utils";

export function SelectValueBadges(props: { items: SelectBadgeItem[]; empty?: JSX.Element }) {
  return (
    <span class="inline-flex min-w-0 flex-wrap items-center gap-1">
      {props.items.length === 0
        ? (props.empty ?? "")
        : props.items.map((item) => (
            <span
              class="badge max-w-full shrink-0 border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] font-medium leading-5 text-secondary"
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
