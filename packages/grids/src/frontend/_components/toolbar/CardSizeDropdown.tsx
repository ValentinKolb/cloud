import { Dropdown } from "@valentinkolb/cloud/ui";
import { Show } from "solid-js";
import type { CardSize } from "../records-view/query-url";

const cardSizeOptions: Array<{ value: CardSize; label: string; icon: string; description: string }> = [
  { value: "small", label: "Small cards", icon: "ti ti-layout-grid", description: "More cards per row." },
  { value: "medium", label: "Medium cards", icon: "ti ti-layout-cards", description: "Balanced view." },
  { value: "large", label: "Large cards", icon: "ti ti-square", description: "Bigger covers." },
];

export function CardSizeDropdown(props: { value: CardSize; onChange: (size: CardSize) => void }) {
  const selected = () => cardSizeOptions.find((option) => option.value === props.value) ?? cardSizeOptions[1]!;

  return (
    <Dropdown
      position="bottom-right"
      width="w-56"
      trigger={
        <span class="btn-input-primary btn-input-sm">
          <i class={selected().icon} />
          {selected().label}
          <i class="ti ti-chevron-down text-[10px] opacity-60" />
        </span>
      }
      elements={cardSizeOptions.map((option) => ({
        element: (close) => (
          <button
            type="button"
            class={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-white/10 ${
              option.value === props.value ? "text-blue-600 dark:text-blue-400" : "text-zinc-700 dark:text-zinc-300"
            }`}
            onClick={() => {
              props.onChange(option.value);
              close();
            }}
          >
            <i class={`${option.icon} shrink-0 text-base`} />
            <span class="min-w-0">
              <span class="block truncate font-medium">{option.label}</span>
              <span class="block truncate text-xs text-dimmed">{option.description}</span>
            </span>
            <Show when={option.value === props.value}>
              <i class="ti ti-check ml-auto text-blue-500" />
            </Show>
          </button>
        ),
      }))}
    />
  );
}
