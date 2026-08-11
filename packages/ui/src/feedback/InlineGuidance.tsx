import { type JSX, Show, splitProps } from "solid-js";
import type { IntentTone } from "../semantics";

export type InlineGuidanceProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "class"> & {
  children: JSX.Element;
  tone?: IntentTone;
  icon?: string | false;
  class?: string;
};

export function InlineGuidance(props: InlineGuidanceProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "tone", "icon", "class"]);

  return (
    <div {...rest} class={local.class ? `k2b-inline-guidance ${local.class}` : "k2b-inline-guidance"} data-tone={local.tone ?? "neutral"}>
      <Show when={local.icon}>{(icon) => <i class={`${icon()} k2b-inline-guidance__icon`} aria-hidden="true" />}</Show>
      <div class="k2b-inline-guidance__content">{local.children}</div>
    </div>
  );
}

export default InlineGuidance;
