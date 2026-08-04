import { Tag, Tooltip } from "@k2b/ui";
import type { JSX } from "solid-js";
import type { SelectBadgeItem } from "./select-badge-utils";

export function SelectValueBadges(props: { items: SelectBadgeItem[]; empty?: JSX.Element }) {
  return (
    <span class="inline-flex min-w-0 flex-wrap items-center gap-1">
      {props.items.length === 0
        ? (props.empty ?? "")
        : props.items.map((item) => (
            <Tooltip.Anchor content={`Unknown option: ${item.id}`} disabled={item.known}>
              <Tag size="sm" color={item.color} class={`max-w-full shrink-0 ${item.known ? "" : "opacity-75"}`}>
                {item.label}
              </Tag>
            </Tooltip.Anchor>
          ))}
    </span>
  );
}
