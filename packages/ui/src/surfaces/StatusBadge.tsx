import { type JSX, Show } from "solid-js";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "running" | "degraded";

export type StatusBadgeProps = {
  children?: JSX.Element;
  label?: JSX.Element;
  tone?: StatusTone;
  icon?: string | null;
  dot?: boolean;
  variant?: "chip" | "dot" | "text";
  title?: string;
  class?: string;
};

const DEFAULT_ICONS: Record<StatusTone, string> = {
  neutral: "ti ti-minus",
  info: "ti ti-info-circle",
  success: "ti ti-check",
  warning: "ti ti-alert-triangle",
  danger: "ti ti-alert-circle",
  running: "ti ti-loader-2",
  degraded: "ti ti-plug-connected-x",
};

export function StatusBadge(props: StatusBadgeProps): JSX.Element {
  const tone = () => props.tone ?? "neutral";
  const variant = () => props.variant ?? (props.dot ? "dot" : "chip");
  const icon = () => (props.icon === null ? undefined : (props.icon ?? DEFAULT_ICONS[tone()]));
  const label = () => props.label ?? props.children;

  return (
    <span
      class={`k2b-status-badge ${props.class ?? ""}`}
      data-tone={tone()}
      data-variant={variant()}
      title={props.title}
    >
      <Show when={variant() === "dot"} fallback={<Show when={icon()}>{(glyph) => <i class={glyph()} aria-hidden="true" />}</Show>}>
        <span class="k2b-status-badge__dot" aria-hidden="true" />
      </Show>
      <Show when={label()}>
        {(value) => <span>{value()}</span>}
      </Show>
    </span>
  );
}
