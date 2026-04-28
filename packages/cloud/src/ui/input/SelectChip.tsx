import { For, Show } from "solid-js";
import Dropdown from "../misc/Dropdown";
import type { DropdownItem } from "../misc/Dropdown";

export type SelectChipOption<T extends string | number = string> = {
  value: T;
  label: string;
};

type SelectChipProps<T extends string | number = string> = {
  /** Current value */
  value: T;
  /** Options list */
  options: SelectChipOption<T>[];
  /** Change handler */
  onChange: (value: T) => void;
  /** Optional icon */
  icon?: string;
  /** Dropdown position */
  position?: "bottom-left" | "bottom-right";
};

/**
 * Minimal single-select chip using Dropdown.
 * Displays current selection inline, opens dropdown on click.
 */
export default function SelectChip<T extends string | number = string>(props: SelectChipProps<T>) {
  const selectedLabel = () => props.options.find((o) => o.value === props.value)?.label ?? "";

  const dropdownElements = (): DropdownItem[] =>
    props.options.map((option) => ({
      element: (
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onChange(option.value);
          }}
        >
          <span class="truncate">{option.label}</span>
          <Show when={option.value === props.value}>
            <i class="ti ti-check text-blue-500 text-xs" />
          </Show>
        </button>
      ),
    }));

  const trigger = (
    <div class="btn-input btn-input-sm">
      <Show when={props.icon}>
        <i class={`${props.icon} text-zinc-500 dark:text-zinc-400`} />
      </Show>
      <span class="truncate">{selectedLabel()}</span>
      <i class="ti ti-chevron-down text-zinc-500 dark:text-zinc-400 text-[10px]" />
    </div>
  );

  return <Dropdown trigger={trigger} elements={dropdownElements()} position={props.position ?? "bottom-right"} width="w-40" />;
}
