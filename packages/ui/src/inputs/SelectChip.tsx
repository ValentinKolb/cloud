import { type JSX, Show } from "solid-js";
import { Dropdown, DropdownItem, type DropdownPosition } from "../actions/Dropdown";

export type SelectChipOption<T extends string | number = string> = {
  value: T;
  label: string;
  icon?: string;
  disabled?: boolean;
};

export type SelectChipProps<T extends string | number = string> = {
  value: T;
  options: readonly SelectChipOption<T>[];
  onValueChange?: (value: T) => void;
  icon?: string;
  label?: string;
  position?: DropdownPosition;
  disabled?: boolean;
  class?: string;
};

export function SelectChip<T extends string | number = string>(props: SelectChipProps<T>): JSX.Element {
  const selected = () => props.options.find((option) => option.value === props.value);

  return (
    <Dropdown
      class={props.class}
      position={props.position ?? "bottom-left"}
      disabled={props.disabled}
      label={props.label ?? "Choose option"}
      trigger={
        <button type="button" class="k2b-select-chip" disabled={props.disabled}>
          <Show when={props.icon ?? selected()?.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
          <span>{selected()?.label ?? String(props.value)}</span>
          <i class="ti ti-chevron-down" aria-hidden="true" />
        </button>
      }
    >
      {props.options.map((option) => (
        <DropdownItem
          icon={option.value === props.value ? "ti ti-check" : option.icon}
          disabled={option.disabled}
          onSelect={() => props.onValueChange?.(option.value)}
        >
          {option.label}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
