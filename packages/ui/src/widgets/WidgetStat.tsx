import { type JSX, Show } from "solid-js";
import type { StatusTone } from "../surfaces";

export type WidgetStatAccent = {
  text?: JSX.Element;
  icon?: string;
  tone?: StatusTone;
};

export type WidgetStatProps = {
  label: JSX.Element;
  value: JSX.Element;
  description?: JSX.Element;
  accent?: WidgetStatAccent;
  tone?: StatusTone;
  class?: string;
};

export function WidgetStat(props: WidgetStatProps): JSX.Element {
  return (
    <div class={`k2b-widget-stat ${props.class ?? ""}`} data-k2b-tone data-tone={props.tone ?? "neutral"}>
      <span class="k2b-widget-stat__label">{props.label}</span>
      <strong class="k2b-widget-stat__value">{props.value}</strong>
      <Show when={props.description || props.accent}>
        <span class="k2b-widget-stat__support">
          <Show when={props.description}>
            <span>{props.description}</span>
          </Show>
          <Show when={props.accent}>
            {(accent) => (
              <span class="k2b-widget-stat__accent" data-k2b-tone data-tone={accent().tone ?? "neutral"}>
                <Show when={accent().icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
                <Show when={accent().text}>
                  <span>{accent().text}</span>
                </Show>
              </span>
            )}
          </Show>
        </span>
      </Show>
    </div>
  );
}

export default WidgetStat;
