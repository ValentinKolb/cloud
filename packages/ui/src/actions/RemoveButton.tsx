import { type JSX, Show, splitProps } from "solid-js";
import { Tooltip } from "../feedback/Tooltip";

export type RemoveButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  ariaLabel: string;
  loading?: boolean;
};

export function RemoveButton(props: RemoveButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, ["ariaLabel", "class", "disabled", "loading"]);
  return (
    <Tooltip content={local.ariaLabel}>
      <button
        {...rest}
        type="button"
        class={`k2b-remove-button ${local.class ?? ""}`}
        aria-label={local.ariaLabel}
        aria-busy={local.loading ? "true" : undefined}
        disabled={local.disabled || local.loading}
      >
        <Show
          when={local.loading}
          fallback={
            <>
              <i class="ti ti-x k2b-remove-button__idle" aria-hidden="true" />
              <i class="ti ti-trash k2b-remove-button__hover" aria-hidden="true" />
            </>
          }
        >
          <i class="ti ti-loader-2 k2b-spin" aria-hidden="true" />
        </Show>
      </button>
    </Tooltip>
  );
}

export default RemoveButton;
