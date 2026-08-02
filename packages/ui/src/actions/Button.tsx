import { Link, type LinkNavigateEvent, type NavigationScrollMode } from "@k2b/ssr/nav";
import { type JSX, Show, splitProps } from "solid-js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "subtle" | "danger" | "success" | "ai";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export type ButtonLinkProps = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "onClick"> & {
  navigation?: "document" | "enhanced";
  onClick?: JSX.EventHandlerUnion<HTMLAnchorElement, MouseEvent>;
  onNavigate?: (event: LinkNavigateEvent) => void | Promise<void>;
  replace?: boolean;
  scroll?: NavigationScrollMode;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

const buttonClass = (className?: string): string => ["k2b-button", className].filter(Boolean).join(" ");

export function Button(props: ButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class", "disabled", "loading", "loadingLabel", "size", "type", "variant"]);

  return (
    <button
      {...rest}
      type={local.type ?? "button"}
      class={buttonClass(local.class)}
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

export function ButtonLink(props: ButtonLinkProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "children",
    "class",
    "href",
    "navigation",
    "onClick",
    "onNavigate",
    "replace",
    "scroll",
    "size",
    "variant",
  ]);
  const className = buttonClass(local.class);
  const content = <span class="k2b-button__label">{local.children}</span>;

  if (local.navigation === "enhanced" && local.href) {
    return (
      <Link
        {...rest}
        href={local.href}
        class={className}
        data-size={local.size ?? "md"}
        data-variant={local.variant ?? "primary"}
        onClick={local.onClick}
        onNavigate={local.onNavigate}
        replace={local.replace}
        scroll={local.scroll}
      >
        {content}
      </Link>
    );
  }

  return (
    <a
      {...rest}
      href={local.href}
      class={className}
      data-size={local.size ?? "md"}
      data-variant={local.variant ?? "primary"}
      onClick={local.onClick}
    >
      {content}
    </a>
  );
}

export type IconButtonProps = Omit<ButtonProps, "children"> & {
  children: JSX.Element;
  label: string;
};

export type IconButtonLinkProps = Omit<ButtonLinkProps, "children"> & {
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

export function IconButtonLink(props: IconButtonLinkProps): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "class", "label", "variant"]);

  return (
    <ButtonLink
      {...rest}
      variant={local.variant ?? "ghost"}
      class={`k2b-icon-button ${local.class ?? ""}`}
      aria-label={local.label}
      title={rest.title ?? local.label}
    >
      {local.children}
    </ButtonLink>
  );
}
