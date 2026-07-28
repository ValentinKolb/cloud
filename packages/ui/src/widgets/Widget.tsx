import { type JSX, Show } from "solid-js";

export type WidgetSize = "content" | "compact" | "standard";

export type WidgetProps = {
  title: JSX.Element;
  subtitle?: JSX.Element;
  meta?: JSX.Element;
  icon?: string;
  href?: string;
  action?: JSX.Element;
  size?: WidgetSize;
  class?: string;
  children: JSX.Element;
};

const WidgetHeadingContent = (props: WidgetProps): JSX.Element => (
  <>
    <Show when={props.icon}>{(icon) => <i class={`${icon()} k2b-widget__icon`} aria-hidden="true" />}</Show>
    <span class="k2b-widget__heading">
      <strong>{props.title}</strong>
      <Show when={props.meta ?? props.subtitle}>
        {(meta) => <small>{meta()}</small>}
      </Show>
    </span>
    <Show when={props.action} fallback={props.href ? <i class="ti ti-chevron-right k2b-widget__chevron" aria-hidden="true" /> : null}>
      <span class="k2b-widget__action">{props.action}</span>
    </Show>
  </>
);

export function Widget(props: WidgetProps): JSX.Element {
  const className = () => `k2b-widget ${props.class ?? ""}`;
  return (
    <section class={className()} data-size={props.size ?? "standard"}>
      <Show
        when={props.href}
        fallback={
          <header class="k2b-widget__header">
            <WidgetHeadingContent {...props} />
          </header>
        }
      >
        {(href) => (
          <a href={href()} class="k2b-widget__header">
            <WidgetHeadingContent {...props} />
          </a>
        )}
      </Show>
      <div class="k2b-widget__body">{props.children}</div>
    </section>
  );
}

export default Widget;
