import { type JSX, Show } from "solid-js";
import type { StatusTone } from "../surfaces";

export type WidgetStatusProps = {
  title: JSX.Element;
  description?: JSX.Element;
  message?: JSX.Element;
  icon?: string;
  tone?: StatusTone;
  grow?: boolean;
  class?: string;
};

export function WidgetStatus(props: WidgetStatusProps): JSX.Element {
  const tone = () => props.tone ?? "neutral";
  const icon = () => {
    if (props.icon) return props.icon;
    if (tone() === "success") return "ti ti-circle-check";
    if (tone() === "warning" || tone() === "degraded") return "ti ti-alert-triangle";
    if (tone() === "danger") return "ti ti-alert-circle";
    if (tone() === "info") return "ti ti-info-circle";
    if (tone() === "running") return "ti ti-loader-2";
    return "ti ti-minus";
  };

  return (
    <div
      class={`k2b-widget-status ${props.class ?? ""}`}
      data-k2b-tone
      data-tone={tone()}
      data-grow={props.grow ? "true" : undefined}
    >
      <i class={`${icon()} k2b-widget-status__icon`} aria-hidden="true" />
      <span>
        <strong>{props.title}</strong>
        <Show when={props.description ?? props.message}>
          {(description) => <small>{description()}</small>}
        </Show>
      </span>
    </div>
  );
}

export default WidgetStatus;
