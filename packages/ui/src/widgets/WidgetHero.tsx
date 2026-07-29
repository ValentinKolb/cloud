import { type JSX, Show } from "solid-js";

export type WidgetTone = "emerald" | "amber" | "red" | "blue" | "zinc";

export type WidgetHeroProps = {
  title: string;
  subtitle?: string;
  icon?: string;
  tone?: WidgetTone;
};

export function WidgetHero(props: WidgetHeroProps): JSX.Element {
  return (
    <div class="k2b-widget-hero" data-tone={props.tone}>
      <Show when={props.icon}>{(icon) => <i class={`${icon()} k2b-widget-hero__icon`} aria-hidden="true" />}</Show>
      <span class="k2b-widget-hero__title">{props.title}</span>
      <Show when={props.subtitle}>{(subtitle) => <span class="k2b-widget-hero__subtitle">{subtitle()}</span>}</Show>
    </div>
  );
}

export default WidgetHero;
