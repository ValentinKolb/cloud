import { createEffect, createSignal, Show } from "solid-js";
import type { DropdownItem } from "../misc/Dropdown";
import Dropdown from "../misc/Dropdown";

// =============================================================================
// Types
// =============================================================================

export type FilterChipOption = {
  value: string;
  label: string;
  icon?: string;
  color?: string;
};

export type FilterChipSection = {
  label?: string;
  options: FilterChipOption[];
  /** Allow multiple selections in this section (default: false) */
  multiple?: boolean;
};

type FilterChipProps = {
  /** Chip label */
  label: string;
  /** Chip icon */
  icon: string;
  /** Options as sections (use single section for flat list) */
  options: FilterChipSection[];
  /** Selected values (controlled) */
  value: string[];
  /** Called on change */
  onChange: (value: string[]) => void;
  /** Override active styling (default: value.length > 0) */
  isActive?: boolean;
  /** Dropdown position (default: "bottom-right") */
  position?: "bottom-left" | "bottom-right";
  /**
   * Default values for reset (instead of clear).
   * If provided, shows "Reset" instead of "Clear" and hides when at default.
   * Also hides the count in the trigger.
   */
  defaultValue?: string[];
  /** Render only the trigger icon while keeping the label as accessible title text. */
  iconOnly?: boolean;
};

// =============================================================================
// Component
// =============================================================================

/**
 * Filter chip using the shared Dropdown component.
 * Each section can be single-select or multi-select independently.
 * Changes are committed immediately so URL-backed filters update without losing focus.
 */
export default function FilterChip(props: FilterChipProps) {
  // Local selection state (tracks pending changes)
  const [localValue, setLocalValue] = createSignal<string[]>([...props.value]);

  // Sync local state when props change
  createEffect(() => setLocalValue([...props.value]));

  // Computed values
  const isActive = () => props.isActive ?? localValue().length > 0;
  const isSelected = (value: string) => localValue().includes(value);
  const selectedCount = () => localValue().length;
  const hasDefaultValue = () => (props.defaultValue?.length ?? 0) > 0;

  const isAtDefault = () => {
    const def = props.defaultValue;
    if (!def) return false;
    const local = localValue();
    return local.length === def.length && local.every((v) => def.includes(v));
  };

  // Find which section a value belongs to
  const getSectionForValue = (value: string) => props.options.findIndex((s) => s.options.some((o) => o.value === value));

  const commitValue = (nextValue: string[]) => {
    setLocalValue(nextValue);
    props.onChange(nextValue);
  };

  // Toggle option selection
  const toggleOption = (value: string) => {
    const sectionIndex = getSectionForValue(value);
    const section = props.options[sectionIndex];
    if (!section) return;

    const isMultiple = section.multiple ?? false;

    const prev = localValue();
    const isCurrentlySelected = prev.includes(value);
    if (isMultiple) {
      commitValue(isCurrentlySelected ? prev.filter((v) => v !== value) : [...prev, value]);
      return;
    }

    // Single-select: replace any value from this section.
    const sectionValues = new Set(section.options.map((o) => o.value));
    const otherValues = prev.filter((v) => !sectionValues.has(v));
    commitValue(isCurrentlySelected ? otherValues : [...otherValues, value]);
  };

  const clearOrReset = () => commitValue(props.defaultValue ? [...props.defaultValue] : []);

  // Build dropdown elements
  const dropdownElements = (): DropdownItem[] => {
    const elements: DropdownItem[] = [];

    for (const section of props.options) {
      const isMultiple = section.multiple ?? false;

      const sectionItems = section.options.map((option) => ({
        element: (
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 transition-colors hover:bg-white/30 dark:hover:bg-white/10"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleOption(option.value);
            }}
          >
            <Show when={isMultiple}>
              <input
                type="checkbox"
                checked={isSelected(option.value)}
                readOnly
                aria-hidden="true"
                tabindex={-1}
                class="shrink-0 pointer-events-none"
              />
            </Show>

            <Show when={option.icon && !isMultiple}>
              <i class={`${option.icon} ${isSelected(option.value) ? "text-blue-500" : "text-zinc-400"}`} />
            </Show>

            <Show when={option.color}>
              <div class="w-3 h-3 rounded-full shrink-0" style={`background-color: ${option.color}`} />
            </Show>

            <span class="flex-1 truncate text-left">{option.label}</span>

            <Show when={!isMultiple && isSelected(option.value)}>
              <i class="ti ti-check text-blue-500" />
            </Show>
          </button>
        ),
      }));

      if (section.label) {
        elements.push({ sectionLabel: section.label, items: sectionItems });
      } else {
        elements.push(...sectionItems);
      }
    }

    // Add clear/reset button when applicable
    const shouldShowButton = hasDefaultValue() ? !isAtDefault() : selectedCount() > 0;
    if (shouldShowButton) {
      elements.push({
        items: [
          {
            icon: hasDefaultValue() ? "ti ti-refresh" : "ti ti-x",
            label: hasDefaultValue() ? "Reset" : "Clear",
            variant: "danger" as const,
            action: clearOrReset,
          },
        ],
      });
    }

    return elements;
  };

  const trigger = (
    <div
      data-state={isActive() ? "active" : "idle"}
      class={`filter-chip-trigger btn-input btn-input-sm ${props.iconOnly ? "h-8 w-8 justify-center px-0" : ""} ${isActive() ? "btn-input-active" : ""}`}
      role="button"
      aria-label={props.label}
      title={props.iconOnly ? props.label : undefined}
    >
      <i class={`${props.icon} ${isActive() ? "text-blue-600 dark:text-blue-300" : "text-zinc-500 dark:text-zinc-400"}`} />
      <Show when={!props.iconOnly}>
        <span class={isActive() ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300"}>
          {props.label}
          <Show when={!hasDefaultValue() && selectedCount() > 0}>{` (${selectedCount()})`}</Show>
        </span>
        <i class="ti ti-chevron-down text-zinc-400 text-[10px]" />
      </Show>
    </div>
  );

  return <Dropdown trigger={trigger} elements={dropdownElements()} position={props.position ?? "bottom-left"} width="w-52" />;
}
