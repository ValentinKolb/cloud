import { createUniqueId, For, type JSX } from "solid-js";

export type SegmentedControlOption<T extends string = string> = {
  value: T;
  label: JSX.Element;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string = string> = {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  size?: "sm" | "md";
  class?: string;
};

export function SegmentedControl<T extends string = string>(props: SegmentedControlProps<T>): JSX.Element {
  const name = `k2b-segment-${createUniqueId()}`;
  const buttons: HTMLButtonElement[] = [];

  const moveFocus = (currentIndex: number, direction: 1 | -1) => {
    const enabled = props.options.map((option, index) => ({ option, index })).filter(({ option }) => !props.disabled && !option.disabled);
    const enabledIndex = enabled.findIndex(({ index }) => index === currentIndex);
    const next = enabled[(enabledIndex + direction + enabled.length) % enabled.length];
    if (next) buttons[next.index]?.focus();
  };

  return (
    <div class={`k2b-segmented-control ${props.class ?? ""}`} data-size={props.size ?? "md"} role="radiogroup" aria-label={props.label}>
      <For each={props.options}>
        {(option, index) => (
          <button
            ref={(element) => {
              buttons[index()] = element;
            }}
            type="button"
            role="radio"
            name={name}
            class="k2b-segmented-control__option"
            aria-checked={props.value === option.value}
            data-selected={props.value === option.value ? "true" : undefined}
            disabled={props.disabled || option.disabled}
            tabIndex={props.value === option.value ? 0 : -1}
            onClick={() => props.onValueChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                moveFocus(index(), 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                moveFocus(index(), -1);
              }
            }}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}
