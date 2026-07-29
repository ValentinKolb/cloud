import { For, type JSX, Show } from "solid-js";
import type { WidgetTone } from "./WidgetHero";

export type WidgetPill = {
  label: string;
  value: string | number;
  tone?: WidgetTone;
  href?: string;
};

export type WidgetPillsProps = {
  pills: WidgetPill[];
  grow?: boolean;
};

function Content(props: { pill: WidgetPill }): JSX.Element {
  return <><span class="k2b-widget-pill__label">{props.pill.label}</span><span class="k2b-widget-pill__value">{props.pill.value}</span></>;
}

export function WidgetPills(props: WidgetPillsProps): JSX.Element {
  return (
    <div class="k2b-widget-pills" data-grow={props.grow ? "true" : undefined}>
      <For each={props.pills}>
        {(pill) => (
          <Show
            when={pill.href}
            fallback={<span class="k2b-widget-pill" data-tone={pill.tone ?? "zinc"}><Content pill={pill} /></span>}
          >
            {(href) => <a href={href()} class="k2b-widget-pill" data-tone={pill.tone ?? "zinc"}><Content pill={pill} /></a>}
          </Show>
        )}
      </For>
    </div>
  );
}

export default WidgetPills;
