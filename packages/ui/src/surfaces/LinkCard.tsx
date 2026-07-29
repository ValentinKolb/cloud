import type { JSX } from "solid-js";

export type LinkCardColor = "blue" | "emerald" | "violet" | "orange" | "red" | "amber" | "zinc" | "cyan" | "rose";

export type LinkCardProps = {
  href: string;
  title: string;
  description: string;
  icon: string;
  color: LinkCardColor;
};

export function LinkCard(props: LinkCardProps): JSX.Element {
  return (
    <a href={props.href} class="k2b-link-card" data-color={props.color}>
      <div class="k2b-link-card__icon">
        <i class={`${props.icon} k2b-link-card__glyph`} aria-hidden="true" />
      </div>
      <div class="k2b-link-card__copy">
        <span class="k2b-link-card__title">{props.title}</span>
        <p class="k2b-link-card__description">{props.description}</p>
      </div>
      <i class="ti ti-chevron-right k2b-link-card__chevron" aria-hidden="true" />
    </a>
  );
}

export default LinkCard;
