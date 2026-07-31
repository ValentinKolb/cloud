import { For, type JSX, Show } from "solid-js";
import type { IntentTone } from "../semantics";

export type NoticeTone = Extract<IntentTone, "info" | "warning" | "danger">;

export type NoticeCardProps = {
  tone?: NoticeTone;
  title: JSX.Element;
  detail?: JSX.Element;
  icon?: string;
  class?: string;
};

const DEFAULT_ICONS: Record<NoticeTone, string> = {
  info: "ti ti-info-circle",
  warning: "ti ti-alert-triangle",
  danger: "ti ti-alert-circle",
};

function NoticeCardComponent(props: NoticeCardProps): JSX.Element {
  const tone = () => props.tone ?? "warning";
  return (
    <article class={`k2b-notice-card ${props.class ?? ""}`} data-tone={tone()}>
      <div class="k2b-notice-card__inner">
        <i class={`${props.icon ?? DEFAULT_ICONS[tone()]} k2b-notice-card__icon`} aria-hidden="true" />
        <div class="k2b-notice-card__content">
          <p class="k2b-notice-card__title">{props.title}</p>
          <Show when={props.detail}>{(detail) => <p class="k2b-notice-card__description">{detail()}</p>}</Show>
        </div>
      </div>
    </article>
  );
}

export type NoticeGridProps<T> = {
  items: readonly T[];
  children: (item: T) => JSX.Element;
  class?: string;
};

function NoticeGrid<T>(props: NoticeGridProps<T>): JSX.Element {
  const columns = () => (props.items.length <= 1 ? "one" : props.items.length === 2 ? "two" : "three");
  return (
    <Show when={props.items.length > 0}>
      <div class={`k2b-notice-grid ${props.class ?? ""}`} data-columns={columns()}>
        <For each={props.items}>{(item) => props.children(item)}</For>
      </div>
    </Show>
  );
}

export const NoticeCard = Object.assign(NoticeCardComponent, { Grid: NoticeGrid });
export default NoticeCard;
