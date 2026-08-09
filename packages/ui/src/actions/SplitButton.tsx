import { type JSX, splitProps } from "solid-js";
import { Button, type ButtonProps } from "./Button";
import { Dropdown, type DropdownItem, type DropdownPosition } from "./Dropdown";

export type SplitButtonProps = ButtonProps & {
  /** Actions shown from the secondary menu trigger. */
  items: readonly DropdownItem[];
  /** Accessible name and title for the icon-only menu trigger. */
  menuLabel: string;
  menuPosition?: DropdownPosition | (() => DropdownPosition);
  menuWidth?: string;
};

/** One primary button action with a separate menu of related alternatives. */
export function SplitButton(props: SplitButtonProps): JSX.Element {
  const [local, buttonProps] = splitProps(props, [
    "children",
    "class",
    "disabled",
    "items",
    "loading",
    "menuLabel",
    "menuPosition",
    "menuWidth",
    "size",
    "variant",
  ]);
  const disabled = () => Boolean(local.disabled || local.loading);

  return (
    <Dropdown.Root
      class="k2b-split-button"
      disabled={disabled()}
      items={local.items}
      label={local.menuLabel}
      position={local.menuPosition ?? "bottom-left"}
      width={local.menuWidth}
    >
      <Button
        {...buttonProps}
        class={`k2b-split-button__primary ${local.class ?? ""}`}
        disabled={local.disabled}
        loading={local.loading}
        size={local.size}
        variant={local.variant ?? "primary"}
      >
        {local.children}
      </Button>
      <Dropdown.Trigger
        class="k2b-split-button__menu-trigger"
        disabled={disabled()}
        iconOnly
        label={local.menuLabel}
        size={local.size}
        title={local.menuLabel}
        variant={local.variant ?? "primary"}
      >
        <i class="ti ti-chevron-down" aria-hidden="true" />
      </Dropdown.Trigger>
    </Dropdown.Root>
  );
}
