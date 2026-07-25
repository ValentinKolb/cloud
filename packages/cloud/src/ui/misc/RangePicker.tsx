import { For } from "solid-js";

/**
 * RangePicker — the time window every observability surface needs.
 *
 * Rendered as links rather than buttons on purpose: window selection is a
 * server concern (the query, not the rendering), so it belongs in the URL and
 * works without hydration. Callers supply the href per option, which is what
 * lets each page keep its own other params intact — the hand-rolled copies
 * differed exactly there, with one silently dropping every unrelated filter.
 *
 * The vocabulary stays with the caller too. Traces think in `10m…30d`, request
 * telemetry in `1h…30d`, audit in days; a single hardcoded list would be wrong
 * for most of them.
 */
export type RangeOption<T extends string> = {
  value: T;
  /** Defaults to the value, which is already short by convention (`24h`). */
  label?: string;
  href: string;
};

export type RangePickerProps<T extends string> = {
  options: readonly RangeOption<T>[];
  value: T;
  /** Leading caption. Pass `null` to omit it in tight toolbars. */
  label?: string | null;
  /** Names the control for assistive tech; defaults to the visible label. */
  ariaLabel?: string;
  class?: string;
};

export default function RangePicker<T extends string>(props: RangePickerProps<T>) {
  const caption = () => (props.label === null ? null : (props.label ?? "Window"));
  return (
    <nav class={`flex flex-wrap items-center gap-1 ${props.class ?? ""}`} aria-label={props.ariaLabel ?? caption() ?? "Range"}>
      {caption() ? <span class="mr-1 text-[10px] text-dimmed">{caption()}</span> : null}
      <For each={props.options}>
        {(option) => (
          <a
            href={option.href}
            class={`btn-input btn-input-sm ${option.value === props.value ? "btn-input-active" : ""}`}
            aria-current={option.value === props.value ? "true" : undefined}
          >
            {option.label ?? option.value}
          </a>
        )}
      </For>
    </nav>
  );
}
