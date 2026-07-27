import { type JSX, Show } from "solid-js";

export type WidgetSize = "content" | "compact" | "standard";

export type WidgetProps = {
  title: JSX.Element;
  subtitle?: JSX.Element;
  icon?: string;
  href?: string;
  action?: JSX.Element;
  size?: WidgetSize;
  class?: string;
  children: JSX.Element;
};

const WidgetHeading = (props: WidgetProps): JSX.Element => (
  <header class="k2b-widget__header">
    <Show when={props.icon}>{(icon) => <i class={`${icon()} k2b-widget__icon`} aria-hidden="true" />}</Show>
    <span class="k2b-widget__heading">
      <strong>{props.title}</strong>
      <Show when={props.subtitle}>
        <small>{props.subtitle}</small>
      </Show>
    </span>
    <Show when={props.action} fallback={props.href ? <i class="ti ti-chevron-right k2b-widget__chevron" aria-hidden="true" /> : null}>
      <span class="k2b-widget__action">{props.action}</span>
    </Show>
  </header>
);

export function Widget(props: WidgetProps): JSX.Element {
  const className = () => `k2b-widget ${props.class ?? ""}`;
  const content = (
    <>
      <WidgetHeading {...props} />
      <div class="k2b-widget__body">{props.children}</div>
    </>
  );

  return (
    <Show
      when={props.href}
      fallback={
        <section class={className()} data-size={props.size ?? "standard"}>
          {content}
        </section>
      }
    >
      {(href) => (
        <a href={href()} class={className()} data-size={props.size ?? "standard"}>
          {content}
        </a>
      )}
    </Show>
  );
}

export default Widget;
