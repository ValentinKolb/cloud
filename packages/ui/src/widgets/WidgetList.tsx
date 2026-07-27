import { For, type JSX, Show } from "solid-js";
import type { StatusTone } from "../surfaces";

export type WidgetListItem = {
  label: JSX.Element;
  description?: JSX.Element;
  meta?: JSX.Element;
  icon?: string;
  tone?: StatusTone;
  href?: string;
};

export type WidgetListProps = {
  items: readonly WidgetListItem[];
  empty?: JSX.Element;
  class?: string;
};

const ItemContent = (props: { item: WidgetListItem }): JSX.Element => (
  <>
    <Show when={props.item.icon}>
      {(icon) => <i class={`${icon()} k2b-widget-list__icon`} data-k2b-tone data-tone={props.item.tone ?? "neutral"} aria-hidden="true" />}
    </Show>
    <span class="k2b-widget-list__copy">
      <strong>{props.item.label}</strong>
      <Show when={props.item.description}>
        <small>{props.item.description}</small>
      </Show>
    </span>
    <Show when={props.item.meta}>
      <span class="k2b-widget-list__meta">{props.item.meta}</span>
    </Show>
    <Show when={props.item.href}>
      <i class="ti ti-chevron-right k2b-widget-list__chevron" aria-hidden="true" />
    </Show>
  </>
);

export function WidgetList(props: WidgetListProps): JSX.Element {
  return (
    <div class={`k2b-widget-list ${props.class ?? ""}`}>
      <Show when={props.items.length > 0} fallback={<div class="k2b-widget-list__empty">{props.empty ?? "Nothing here yet."}</div>}>
        <For each={props.items}>
          {(item) => (
            <Show
              when={item.href}
              fallback={
                <div class="k2b-widget-list__item">
                  <ItemContent item={item} />
                </div>
              }
            >
              {(href) => (
                <a href={href()} class="k2b-widget-list__item">
                  <ItemContent item={item} />
                </a>
              )}
            </Show>
          )}
        </For>
      </Show>
    </div>
  );
}

export default WidgetList;
