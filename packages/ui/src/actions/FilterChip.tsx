import { createEffect, createMemo, createSignal, type JSX, Show } from "solid-js";
import Dropdown, { type DropdownItem } from "./Dropdown";

export type FilterChipOption = {
  value: string;
  label: string;
  icon?: string;
  color?: string;
};

export type FilterChipSection = {
  label?: string;
  options: readonly FilterChipOption[];
  multiple?: boolean;
};

type FilterChipChange =
  | { onChange: (value: string[]) => void; onValueChange?: (value: string[]) => void }
  | { onChange?: (value: string[]) => void; onValueChange: (value: string[]) => void };

export type FilterChipProps = FilterChipChange & {
  label: string;
  icon: string;
  options: readonly FilterChipSection[];
  value: readonly string[];
  isActive?: boolean;
  position?: "bottom-left" | "bottom-right";
  defaultValue?: readonly string[];
  iconOnly?: boolean;
  class?: string;
};

/** Section-aware controlled filter with immediate single- and multi-select commits. */
export function FilterChip(props: FilterChipProps): JSX.Element {
  const [localValue, setLocalValue] = createSignal<string[]>([...props.value]);

  createEffect(() => setLocalValue([...props.value]));

  const hasDefault = () => props.defaultValue !== undefined;
  const selected = (value: string) => localValue().includes(value);
  const active = () => props.isActive ?? localValue().length > 0;
  const atDefault = () => {
    if (!props.defaultValue) return false;
    const current = localValue();
    return current.length === props.defaultValue.length && current.every((value) => props.defaultValue?.includes(value));
  };
  const emit = (value: string[]) => {
    setLocalValue(value);
    const onChange = props.onChange ?? props.onValueChange;
    onChange?.(value);
  };
  const toggle = (value: string) => {
    const section = props.options.find((candidate) => candidate.options.some((option) => option.value === value));
    if (!section) return;
    const current = localValue();
    if (section.multiple) {
      emit(selected(value) ? current.filter((entry) => entry !== value) : [...current, value]);
      return;
    }
    const sectionValues = new Set(section.options.map((option) => option.value));
    const otherValues = current.filter((entry) => !sectionValues.has(entry));
    emit(selected(value) ? otherValues : [...otherValues, value]);
  };
  const reset = () => emit(props.defaultValue ? [...props.defaultValue] : []);

  const elements = createMemo<DropdownItem[]>(() => {
    const result: DropdownItem[] = props.options.map((section) => ({
      sectionLabel: section.label,
      items: section.options.map((option) => ({
        element: (
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={selected(option.value)}
            class="k2b-filter-chip__option"
            data-selected={selected(option.value) ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggle(option.value);
            }}
          >
            <Show when={section.multiple}>
              <span class="k2b-filter-chip__checkbox" aria-hidden="true">
                <Show when={selected(option.value)}>
                  <i class="ti ti-check" />
                </Show>
              </span>
            </Show>
            <Show when={!section.multiple ? option.icon : undefined}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
            <Show when={option.color}>
              {(color) => <span class="k2b-filter-chip__color" style={{ "--k2b-filter-color": color() }} aria-hidden="true" />}
            </Show>
            <span>{option.label}</span>
            <Show when={!section.multiple && selected(option.value)}>
              <i class="ti ti-check k2b-filter-chip__check" aria-hidden="true" />
            </Show>
          </button>
        ),
      })),
    }));

    if ((hasDefault() && !atDefault()) || (!hasDefault() && localValue().length > 0)) {
      result.push({
        items: [
          {
            icon: hasDefault() ? "ti ti-refresh" : "ti ti-x",
            label: hasDefault() ? "Reset" : "Clear",
            variant: "danger",
            action: reset,
          },
        ],
      });
    }
    return result;
  });

  return (
    <Dropdown
      trigger={
        <span
          class={`k2b-filter-chip ${props.class ?? ""}`}
          data-active={active() ? "true" : undefined}
          data-icon-only={props.iconOnly ? "true" : undefined}
          role="button"
          aria-label={props.label}
          title={props.iconOnly ? props.label : undefined}
        >
          <i class={props.icon} aria-hidden="true" />
          <Show when={!props.iconOnly}>
            <span>
              {props.label}
              <Show when={!hasDefault() && localValue().length > 0}>{` (${localValue().length})`}</Show>
            </span>
            <i class="ti ti-chevron-down k2b-filter-chip__chevron" aria-hidden="true" />
          </Show>
        </span>
      }
      elements={elements()}
      position={props.position ?? "bottom-left"}
      width="k2b-dropdown__menu--filter"
      label={props.label}
    />
  );
}

export default FilterChip;
