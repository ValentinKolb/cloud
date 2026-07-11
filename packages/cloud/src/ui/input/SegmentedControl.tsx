import { For } from "solid-js";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: string;
};

export type SegmentedControlProps<T extends string> = {
  options: SegmentOption<T>[];
  value: () => T;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
};

/**
 * Segmented control for switching between options.
 * Similar to iOS segmented control or radio button group.
 */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel = "Options",
}: SegmentedControlProps<T>) {
  const optionRefs: HTMLButtonElement[] = [];

  const selectIndex = (index: number) => {
    const next = options[index];
    if (!next) return;
    onChange(next.value);
    queueMicrotask(() => optionRefs[index]?.focus());
  };

  const selectRelative = (currentIndex: number, direction: -1 | 1) => {
    if (options.length === 0) return;
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    selectIndex(nextIndex);
  };

  const onSegmentKeyDown = (event: KeyboardEvent, currentIndex: number) => {
    if (disabled) return;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectRelative(currentIndex, 1);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectRelative(currentIndex, -1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      selectIndex(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      selectIndex(options.length - 1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      aria-disabled={disabled ? "true" : undefined}
      class="segmented-control"
      classList={{ "opacity-50 pointer-events-none": disabled }}
    >
      <For each={options}>
        {(option, index) => (
          <button
            ref={(element) => {
              optionRefs[index()] = element;
            }}
            type="button"
            role="radio"
            aria-checked={value() === option.value}
            tabIndex={value() === option.value ? 0 : -1}
            class="segmented-control-item"
            data-divider={
              index() < options.length - 1 && value() !== option.value && value() !== options[index() + 1]?.value ? "true" : undefined
            }
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onSegmentKeyDown(event, index())}
            disabled={disabled}
          >
            {option.icon && <i class={option.icon} />}
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}

export default SegmentedControl;
