import { type JSX, Show } from "solid-js";
import type { StatusTone } from "../surfaces";

export type WidgetStatusProps = {
  title: JSX.Element;
  description?: JSX.Element;
  icon?: string;
  tone?: StatusTone;
  class?: string;
};

export function WidgetStatus(props: WidgetStatusProps): JSX.Element {
  return (
    <div class={`k2b-widget-status ${props.class ?? ""}`} data-k2b-tone data-tone={props.tone ?? "neutral"}>
      <Show when={props.icon}>{(icon) => <i class={`${icon()} k2b-widget-status__icon`} aria-hidden="true" />}</Show>
      <span>
        <strong>{props.title}</strong>
        <Show when={props.description}>
          <small>{props.description}</small>
        </Show>
      </span>
    </div>
  );
}

export default WidgetStatus;
