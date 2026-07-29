import type { JSX } from "solid-js";

export type WidgetCardProps = {
  title: string;
  icon: string;
  children: JSX.Element;
};

export function WidgetCard(props: WidgetCardProps): JSX.Element {
  return (
    <div class="k2b-widget-card">
      <div class="k2b-widget-card__header">
        <i class={`ti ti-${props.icon}`} aria-hidden="true" />
        <span>{props.title}</span>
      </div>
      {props.children}
    </div>
  );
}

export default WidgetCard;
