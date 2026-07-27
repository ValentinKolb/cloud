import { type JSX, Show } from "solid-js";
import type { StatusTone } from "../surfaces";

export type WidgetHeroProps = {
  title: JSX.Element;
  subtitle?: JSX.Element;
  icon?: string;
  tone?: StatusTone;
  class?: string;
};

export function WidgetHero(props: WidgetHeroProps): JSX.Element {
  return (
    <div class={`k2b-widget-hero ${props.class ?? ""}`} data-k2b-tone data-tone={props.tone ?? "neutral"}>
      <Show when={props.icon}>{(icon) => <i class={`${icon()} k2b-widget-hero__icon`} aria-hidden="true" />}</Show>
      <span class="k2b-widget-hero__content">
        <strong>{props.title}</strong>
        <Show when={props.subtitle}>
          <small>{props.subtitle}</small>
        </Show>
      </span>
    </div>
  );
}

export default WidgetHero;
