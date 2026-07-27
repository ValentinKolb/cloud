import { type JSX, Show } from "solid-js";
import type { StatusTone } from "./StatusBadge";

export type ProgressBarProps = {
  value?: number;
  max?: number;
  label?: JSX.Element;
  tone?: StatusTone;
  size?: "sm" | "md";
  class?: string;
};

export function ProgressBar(props: ProgressBarProps): JSX.Element {
  const max = () => Math.max(props.max ?? 100, 1);
  const value = () => (props.value === undefined ? undefined : Math.min(Math.max(props.value, 0), max()));
  const percent = () => (value() === undefined ? undefined : ((value() ?? 0) / max()) * 100);

  return (
    <div class={`k2b-progress ${props.class ?? ""}`} data-size={props.size ?? "md"} data-tone={props.tone ?? "info"}>
      <Show when={props.label}>
        <div class="k2b-progress__label">{props.label}</div>
      </Show>
      <div
        class="k2b-progress__track"
        role="progressbar"
        aria-label={typeof props.label === "string" ? props.label : undefined}
        aria-valuemin={0}
        aria-valuemax={max()}
        aria-valuenow={value()}
        aria-busy={value() === undefined ? "true" : undefined}
      >
        <div
          class="k2b-progress__value"
          data-indeterminate={value() === undefined ? "true" : undefined}
          style={{ width: percent() === undefined ? undefined : `${percent()}%` }}
        />
      </div>
    </div>
  );
}
