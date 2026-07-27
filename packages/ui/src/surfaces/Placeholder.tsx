import { type JSX, Show } from "solid-js";

export type PlaceholderAlign = "center" | "left";
export type PlaceholderSurface = "none" | "paper";
export type PlaceholderState = "empty" | "loading" | "error";
export type PlaceholderVariant = "compact" | "panel";

export type PlaceholderProps = {
  title?: JSX.Element;
  description?: JSX.Element;
  children?: JSX.Element;
  icon?: string;
  action?: JSX.Element;
  align?: PlaceholderAlign;
  surface?: PlaceholderSurface;
  state?: PlaceholderState;
  variant?: PlaceholderVariant;
  class?: string;
};

const defaultIcon = (state: PlaceholderState): string | undefined =>
  state === "loading" ? "ti ti-loader-2" : state === "error" ? "ti ti-alert-circle" : undefined;

export default function Placeholder(props: PlaceholderProps): JSX.Element {
  const align = () => props.align ?? "center";
  const state = () => props.state ?? "empty";
  const variant = () => props.variant ?? "compact";
  const description = () => props.description ?? props.children;
  const icon = () => props.icon ?? defaultIcon(state());

  return (
    <div
      class={`k2b-placeholder ${props.class ?? ""}`}
      data-align={align()}
      data-state={state()}
      data-surface={props.surface ?? "none"}
      data-variant={variant()}
      role={state() === "error" ? "alert" : state() === "loading" ? "status" : undefined}
      aria-live={state() === "loading" ? "polite" : undefined}
      aria-busy={state() === "loading" ? "true" : undefined}
    >
      <Show when={icon()}>
        {(iconClass) => (
          <span class="k2b-placeholder__icon" aria-hidden="true">
            <i class={iconClass()} />
          </span>
        )}
      </Show>
      <Show when={props.title}>
        <p class="k2b-placeholder__title">{props.title}</p>
      </Show>
      <Show when={description()}>
        <p class="k2b-placeholder__description">{description()}</p>
      </Show>
      <Show when={props.action}>
        <div class="k2b-placeholder__action">{props.action}</div>
      </Show>
    </div>
  );
}
