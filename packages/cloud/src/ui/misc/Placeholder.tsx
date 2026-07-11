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

const alignClass = (align: PlaceholderAlign) => (align === "left" ? "items-start text-left" : "items-center text-center");

export default function Placeholder(props: PlaceholderProps) {
  const align = () => props.align ?? "center";
  const state = () => props.state ?? "empty";
  const variant = () => props.variant ?? "compact";
  const description = () => props.description ?? props.children;
  const surfaceClass = () => (props.surface === "paper" ? "paper" : "");
  const icon = () => props.icon ?? (state() === "loading" ? "ti ti-loader-2" : state() === "error" ? "ti ti-alert-circle" : undefined);
  const stateRole = () => (state() === "error" ? "alert" : state() === "loading" ? "status" : undefined);
  const densityClass = () => (variant() === "panel" ? "min-h-56 gap-2 p-8" : "gap-1 px-3 py-6");

  return (
    <div
      class={`${surfaceClass()} state-placeholder flex flex-col ${alignClass(align())} ${densityClass()} text-xs text-dimmed ${props.class ?? ""}`}
      data-state={state()}
      data-variant={variant()}
      role={stateRole()}
      aria-live={state() === "loading" ? "polite" : undefined}
      aria-busy={state() === "loading" ? "true" : undefined}
    >
      <Show when={icon()}>
        {(iconClass) => (
          <span
            class={`state-placeholder-icon ${variant() === "panel" ? "state-placeholder-icon-panel" : "h-5 w-5"} ${
              state() === "error" ? "state-placeholder-icon-error" : ""
            }`}
          >
            <i
              class={`${iconClass()} ${variant() === "panel" ? "text-xl" : "text-base"} ${state() === "loading" ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </span>
        )}
      </Show>
      <Show when={props.title}>
        <p class={`${variant() === "panel" ? "text-sm font-semibold" : "text-xs font-medium"} text-secondary`}>{props.title}</p>
      </Show>
      <Show when={description()}>
        <p class="max-w-sm text-xs text-dimmed">{description()}</p>
      </Show>
      <Show when={props.action}>
        <div class={variant() === "panel" ? "mt-1" : "mt-2"}>{props.action}</div>
      </Show>
    </div>
  );
}
