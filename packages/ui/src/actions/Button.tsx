import { type JSX, Show, splitProps } from "solid-js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "subtle" | "danger" | "success";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function Button(props: ButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class", "disabled", "loading", "loadingLabel", "size", "type", "variant"]);

  return (
    <button
      {...rest}
      type={local.type ?? "button"}
      class={`k2b-button ${local.class ?? ""}`}
      data-size={local.size ?? "md"}
      data-variant={local.variant ?? "primary"}
      disabled={local.disabled || local.loading}
      aria-busy={local.loading ? "true" : undefined}
    >
      <Show when={local.loading}>
        <i class="ti ti-loader-2 k2b-spin" aria-hidden="true" />
      </Show>
      <span class="k2b-button__label">
        <Show when={local.loading && local.loadingLabel} fallback={local.children}>
          {local.loadingLabel}
        </Show>
      </span>
    </button>
  );
}

export type IconButtonProps = Omit<ButtonProps, "children"> & {
  children: JSX.Element;
  label: string;
};

export function IconButton(props: IconButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class", "label", "loading", "loadingLabel", "variant"]);

  return (
    <Button
      {...rest}
      loading={local.loading}
      variant={local.variant ?? "ghost"}
      class={`k2b-icon-button ${local.class ?? ""}`}
      aria-label={local.loading ? (local.loadingLabel ?? local.label) : local.label}
      title={rest.title ?? local.label}
    >
      <Show when={!local.loading}>{local.children}</Show>
    </Button>
  );
}
