import { type JSX, Show } from "solid-js";
import { colorTintStyle } from "../internal/color";

export type TagSize = "sm" | "md" | "lg";

export type TagProps = {
  children: JSX.Element;
  color?: string | null;
  icon?: string;
  size?: TagSize;
  selected?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
  class?: string;
};

/** Compact label presentation with optional color, icon, and remove action. */
export function Tag(props: TagProps): JSX.Element {
  const icon = () => (props.selected ? "ti ti-check" : props.icon);

  return (
    <span
      class={`k2b-tag ${props.class ?? ""}`}
      data-size={props.size ?? "md"}
      data-selected={props.selected ? "true" : undefined}
      style={colorTintStyle(props.color)}
    >
      <Show when={icon()}>{(value) => <i class={`${value()} k2b-tag__icon`} aria-hidden="true" />}</Show>
      <span class="k2b-tag__label">{props.children}</span>
      <Show when={props.onRemove}>
        {(remove) => (
          <button
            type="button"
            class="k2b-tag__remove"
            aria-label={props.removeLabel ?? "Remove tag"}
            disabled={props.disabled}
            onClick={remove()}
          >
            <i class="ti ti-x" aria-hidden="true" />
          </button>
        )}
      </Show>
    </span>
  );
}

export default Tag;
