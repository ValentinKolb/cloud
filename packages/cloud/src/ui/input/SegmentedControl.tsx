import { For } from "solid-js";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: string;
};

type SegmentedControlProps<T extends string> = {
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
  const selectRelative = (currentIndex: number, direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    const next = options[nextIndex];
    if (next) onChange(next.value);
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
      const first = options[0];
      if (first) onChange(first.value);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const last = options[options.length - 1];
      if (last) onChange(last.value);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      class="inline-flex w-full items-stretch rounded-xl border border-zinc-300/50 bg-zinc-200/60 p-0.5 dark:border-zinc-700/50 dark:bg-zinc-900/50 [box-shadow:var(--theme-recess)]"
      classList={{ "opacity-50 pointer-events-none": disabled }}
    >
      <For each={options}>
        {(option, index) => (
          <button
            type="button"
            role="radio"
            aria-checked={value() === option.value}
            tabIndex={value() === option.value ? 0 : -1}
            class="relative z-0 flex-1 min-w-0 rounded-lg px-2 py-1 text-xs leading-4 flex items-center justify-center gap-1 transition-[background-color,color,box-shadow] duration-150 outline-none"
            classList={{
              "z-10 rounded-[0.95rem] bg-white dark:bg-zinc-800/95 text-zinc-900 dark:text-zinc-100 [box-shadow:var(--theme-bevel-top),0_1px_3px_-1px_rgb(0_0_0/0.2)]":
                value() === option.value,
              "text-zinc-700 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-50/65 dark:hover:bg-zinc-800/35":
                value() !== option.value,
              "after:absolute after:right-0 after:top-1 after:bottom-1 after:w-px after:bg-zinc-300/75 dark:after:bg-zinc-700/75":
                index() < options.length - 1 && value() !== option.value && value() !== options[index() + 1]?.value,
            }}
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
