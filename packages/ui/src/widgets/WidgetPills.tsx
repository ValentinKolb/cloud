import { For, type JSX, Show } from "solid-js";
import type { StatusTone } from "../surfaces";

export type WidgetPill = {
  label: JSX.Element;
  value: JSX.Element;
  tone?: StatusTone;
  href?: string;
};

export type WidgetPillsProps = {
  items: readonly WidgetPill[];
  class?: string;
};

const PillContent = (props: { item: WidgetPill }): JSX.Element => (
  <>
    <span>{props.item.label}</span>
    <strong>{props.item.value}</strong>
  </>
);

export function WidgetPills(props: WidgetPillsProps): JSX.Element {
  return (
    <div class={`k2b-widget-pills ${props.class ?? ""}`}>
      <For each={props.items}>
        {(item) => (
          <Show
            when={item.href}
            fallback={
              <span class="k2b-widget-pill" data-k2b-tone data-tone={item.tone ?? "neutral"}>
                <PillContent item={item} />
              </span>
            }
          >
            {(href) => (
              <a href={href()} class="k2b-widget-pill" data-k2b-tone data-tone={item.tone ?? "neutral"}>
                <PillContent item={item} />
              </a>
            )}
          </Show>
        )}
      </For>
    </div>
  );
}

export default WidgetPills;
