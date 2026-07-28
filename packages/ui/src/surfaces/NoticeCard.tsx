import { type JSX, Show } from "solid-js";
import type { StatusTone } from "./StatusBadge";

export type NoticeCardProps = {
  title: JSX.Element;
  children?: JSX.Element;
  detail?: JSX.Element;
  icon?: string;
  tone?: StatusTone;
  action?: JSX.Element;
  class?: string;
};

export function NoticeCard(props: NoticeCardProps): JSX.Element {
  const icon = () => {
    if (props.icon) return props.icon;
    if (props.tone === "danger") return "ti ti-alert-circle";
    if (props.tone === "warning" || props.tone === "degraded") return "ti ti-alert-triangle";
    return "ti ti-info-circle";
  };

  return (
    <section
      class={`k2b-notice-card ${props.class ?? ""}`}
      data-tone={props.tone ?? "neutral"}
      role={props.tone === "danger" ? "alert" : undefined}
    >
      <i class={`k2b-notice-card__icon ${icon()}`} aria-hidden="true" />
      <div class="k2b-notice-card__content">
        <h3>{props.title}</h3>
        <Show when={props.detail ?? props.children}>
          {(detail) => <div class="k2b-notice-card__description">{detail()}</div>}
        </Show>
      </div>
      <Show when={props.action}>
        <div class="k2b-notice-card__action">{props.action}</div>
      </Show>
    </section>
  );
}

export type NoticeGridProps = {
  children: JSX.Element;
  minItemWidth?: string;
  class?: string;
};

export function NoticeGrid(props: NoticeGridProps): JSX.Element {
  return (
    <div class={`k2b-notice-grid ${props.class ?? ""}`} style={{ "--k2b-notice-min-width": props.minItemWidth ?? "16rem" }}>
      {props.children}
    </div>
  );
}
