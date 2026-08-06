import { For, type JSX, Show, splitProps } from "solid-js";
import type { IntentTone } from "../semantics";

export type NoticeTone = Extract<IntentTone, "neutral" | "info" | "success" | "warning" | "danger">;

type NoticeCardContentProps =
  | { title: JSX.Element; detail?: JSX.Element; children?: JSX.Element }
  | { title?: never; detail?: never; children: JSX.Element };

export type NoticeCardProps = Omit<JSX.HTMLAttributes<HTMLElement>, "children" | "class" | "title"> &
  NoticeCardContentProps & {
    tone?: NoticeTone;
    icon?: string | false;
    class?: string;
    bodyClass?: string;
  };

export const NOTICE_CARD_CLASSES = {
  root: "k2b-notice-card",
  inner: "k2b-notice-card__inner",
  icon: "k2b-notice-card__icon",
  content: "k2b-notice-card__content",
  title: "k2b-notice-card__title",
  description: "k2b-notice-card__description",
  body: "k2b-notice-card__body",
} as const;

export const NOTICE_CARD_ICONS: Readonly<Record<NoticeTone, string>> = {
  neutral: "ti ti-note",
  info: "ti ti-info-circle",
  success: "ti ti-circle-check",
  warning: "ti ti-alert-triangle",
  danger: "ti ti-alert-circle",
};

function NoticeCardComponent(props: NoticeCardProps): JSX.Element {
  const [local, articleProps] = splitProps(props, ["tone", "title", "detail", "children", "icon", "class", "bodyClass"]);
  const tone = () => local.tone ?? "warning";
  return (
    <article {...articleProps} class={`${NOTICE_CARD_CLASSES.root} ${local.class ?? ""}`} data-tone={tone()}>
      <div class={NOTICE_CARD_CLASSES.inner}>
        <Show when={local.icon !== false}>
          <i
            class={`${typeof local.icon === "string" ? local.icon : NOTICE_CARD_ICONS[tone()]} ${NOTICE_CARD_CLASSES.icon}`}
            aria-hidden="true"
          />
        </Show>
        <div class={NOTICE_CARD_CLASSES.content}>
          <Show when={local.title}>{(title) => <p class={NOTICE_CARD_CLASSES.title}>{title()}</p>}</Show>
          <Show when={local.detail}>{(detail) => <p class={NOTICE_CARD_CLASSES.description}>{detail()}</p>}</Show>
          <Show when={local.children}>{(body) => <div class={`${NOTICE_CARD_CLASSES.body} ${local.bodyClass ?? ""}`}>{body()}</div>}</Show>
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
