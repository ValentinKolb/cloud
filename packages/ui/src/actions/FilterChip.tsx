import { createEffect, createMemo, createSignal, type JSX, Show } from "solid-js";
import Dropdown, { DropdownItem, type DropdownElement, type DropdownItem as DropdownItemDefinition } from "./Dropdown";

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

export type FilterChipProps = {
  label: string;
  icon: string;
  options: readonly FilterChipSection[];
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  isActive?: boolean;
  position?: "bottom-left" | "bottom-right";
  defaultValue?: readonly string[];
  iconOnly?: boolean;
  class?: string;
};

type FilterOptionRowProps = {
  option: FilterChipOption;
  multiple: boolean;
  selected: () => boolean;
  onToggle: () => void;
};

function FilterOptionRow(props: FilterOptionRowProps): JSX.Element {
  const content = (
    <>
      <Show when={props.multiple}>
        <span class="k2b-filter-chip__checkbox" aria-hidden="true">
          <Show when={props.selected()}>
            <i class="ti ti-check" />
          </Show>
        </span>
      </Show>
      <Show when={!props.multiple ? props.option.icon : undefined}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
      <Show when={props.option.color}>
        {(color) => <span class="k2b-filter-chip__color" style={{ "--k2b-filter-color": color() }} aria-hidden="true" />}
      </Show>
      <span>{props.option.label}</span>
      <Show when={!props.multiple && props.selected()}>
        <i class="ti ti-check k2b-filter-chip__check" aria-hidden="true" />
      </Show>
    </>
  );
  const onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    props.onToggle();
  };

  return (
    <Show
      when={props.multiple}
      fallback={
        <button
          type="button"
          role="menuitemradio"
          aria-checked={props.selected()}
          tabIndex={-1}
          class="k2b-filter-chip__option"
          data-selected={props.selected() ? "true" : undefined}
          onClick={onClick}
        >
          {content}
        </button>
      }
    >
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={props.selected()}
        tabIndex={-1}
        class="k2b-filter-chip__option"
        data-selected={props.selected() ? "true" : undefined}
        onClick={onClick}
      >
        {content}
      </button>
    </Show>
  );
}

/** Section-aware controlled filter with immediate single- and multi-select commits. */
export function FilterChip(props: FilterChipProps): JSX.Element {
  const [localValue, setLocalValue] = createSignal<string[]>([...props.value]);

  createEffect(() => setLocalValue([...props.value]));

  const selectedValues = createMemo(() => new Set(localValue()));
  const defaultValues = createMemo(() => new Set(props.defaultValue ?? []));
  const sectionByValue = createMemo(() => {
    const sections = new Map<string, FilterChipSection>();
    for (const section of props.options) {
      for (const option of section.options) sections.set(option.value, section);
    }
    return sections;
  });
  const hasDefault = () => (props.defaultValue?.length ?? 0) > 0;
  const selected = (value: string) => selectedValues().has(value);
  const active = () => props.isActive ?? localValue().length > 0;
  const atDefault = () => {
    if (!props.defaultValue) return false;
    const current = localValue();
    return current.length === props.defaultValue.length && current.every((value) => defaultValues().has(value));
  };
  const emit = (value: string[]) => {
    setLocalValue(value);
    props.onValueChange(value);
  };
  const toggle = (value: string) => {
    const section = sectionByValue().get(value);
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
  const showReset = () => (hasDefault() && !atDefault()) || (!hasDefault() && localValue().length > 0);
  const resetItem: DropdownElement = {
    element: () => (
      <Show when={showReset()}>
        <div class="k2b-dropdown__section" data-divided="true" role="group" aria-label="Filter actions">
          <DropdownItem icon={hasDefault() ? "ti ti-refresh" : "ti ti-x"} variant="danger" onSelect={reset}>
            {hasDefault() ? "Reset" : "Clear"}
          </DropdownItem>
        </div>
      </Show>
    ),
  };

  const elements = createMemo<DropdownItemDefinition[]>(() => {
    const result: DropdownItemDefinition[] = [];
    for (const section of props.options) {
      const items = section.options.map((option) => ({
        element: () => (
          <FilterOptionRow
            option={option}
            multiple={Boolean(section.multiple)}
            selected={() => selected(option.value)}
            onToggle={() => toggle(option.value)}
          />
        ),
      }));
      if (section.label) result.push({ sectionLabel: section.label, items });
      else result.push(...items);
    }
    result.push(resetItem);
    return result;
  });

  return (
    <Dropdown
      trigger={
        <div
          class={`k2b-filter-chip ${props.class ?? ""}`}
          data-state={active() ? "active" : "idle"}
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
        </div>
      }
      elements={elements()}
      position={props.position ?? "bottom-left"}
      width="13rem"
      label={props.label}
    />
  );
}

export default FilterChip;
