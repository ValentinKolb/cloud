import { type JSX, Show } from "solid-js";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export type StatusBadgeProps = {
  children: JSX.Element;
  tone?: StatusTone;
  icon?: string;
  dot?: boolean;
  class?: string;
};

export function StatusBadge(props: StatusBadgeProps): JSX.Element {
  return (
    <span class={`k2b-status-badge ${props.class ?? ""}`} data-tone={props.tone ?? "neutral"}>
      <Show when={props.icon} fallback={props.dot ? <span class="k2b-status-badge__dot" /> : null}>
        {(icon) => <i class={icon()} aria-hidden="true" />}
      </Show>
      <span>{props.children}</span>
    </span>
  );
}
