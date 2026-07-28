import { type JSX, Show } from "solid-js";

export type WidgetCardProps = {
  title?: JSX.Element;
  icon?: string;
  description?: JSX.Element;
  action?: JSX.Element;
  class?: string;
  children: JSX.Element;
};

export function WidgetCard(props: WidgetCardProps): JSX.Element {
  return (
    <section class={`k2b-widget-card ${props.class ?? ""}`}>
      <Show when={props.title || props.description || props.action}>
        <header class="k2b-widget-card__header">
          <Show when={props.icon}>{(icon) => <i class={`${icon()} k2b-widget-card__icon`} aria-hidden="true" />}</Show>
          <span class="k2b-widget-card__heading">
            <Show when={props.title}>
              <strong>{props.title}</strong>
            </Show>
            <Show when={props.description}>
              <small>{props.description}</small>
            </Show>
          </span>
          <Show when={props.action}>
            <span>{props.action}</span>
          </Show>
        </header>
      </Show>
      <div class="k2b-widget-card__body">{props.children}</div>
    </section>
  );
}

export default WidgetCard;
