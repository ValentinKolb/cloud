import { type JSX, Show } from "solid-js";
import type { StatusTone } from "./StatusBadge";

export type LinkCardProps = {
  href: string;
  title: JSX.Element;
  description?: JSX.Element;
  icon?: string;
  tone?: StatusTone;
  meta?: JSX.Element;
  class?: string;
};

export function LinkCard(props: LinkCardProps): JSX.Element {
  return (
    <a href={props.href} class={`k2b-link-card ${props.class ?? ""}`} data-k2b-tone data-tone={props.tone ?? "neutral"}>
      <Show when={props.icon}>
        {(icon) => (
          <span class="k2b-link-card__icon">
            <i class={icon()} aria-hidden="true" />
          </span>
        )}
      </Show>
      <span class="k2b-link-card__copy">
        <strong>{props.title}</strong>
        <Show when={props.description}>
          <span>{props.description}</span>
        </Show>
      </span>
      <Show when={props.meta}>
        <span class="k2b-link-card__meta">{props.meta}</span>
      </Show>
      <i class="ti ti-chevron-right k2b-link-card__chevron" aria-hidden="true" />
    </a>
  );
}
