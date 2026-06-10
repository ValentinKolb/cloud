import { type JSX, Show } from "solid-js";

export type PlaceholderAlign = "center" | "left";
export type PlaceholderSurface = "none" | "paper";

export type PlaceholderProps = {
  title?: JSX.Element;
  description?: JSX.Element;
  children?: JSX.Element;
  icon?: string;
  action?: JSX.Element;
  align?: PlaceholderAlign;
  surface?: PlaceholderSurface;
  class?: string;
};

const alignClass = (align: PlaceholderAlign) => (align === "left" ? "items-start text-left" : "items-center text-center");

export default function Placeholder(props: PlaceholderProps) {
  const align = () => props.align ?? "center";
  const description = () => props.description ?? props.children;
  const surfaceClass = () => (props.surface === "paper" ? "paper" : "");

  return (
    <div class={`${surfaceClass()} flex flex-col ${alignClass(align())} gap-1 px-3 py-6 text-xs text-dimmed ${props.class ?? ""}`}>
      <Show when={props.icon}>
        <i class={`${props.icon} text-base text-zinc-400 dark:text-zinc-500`} aria-hidden="true" />
      </Show>
      <Show when={props.title}>
        <p class="text-xs font-medium text-secondary">{props.title}</p>
      </Show>
      <Show when={description()}>
        <p class="max-w-sm text-xs text-dimmed">{description()}</p>
      </Show>
      <Show when={props.action}>
        <div class="mt-2">{props.action}</div>
      </Show>
    </div>
  );
}
