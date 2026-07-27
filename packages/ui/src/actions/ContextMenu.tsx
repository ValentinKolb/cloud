import { createMemo, createSignal, createUniqueId, type JSX, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { type DropdownItem, DropdownItems, type DropdownPosition, dropdownPosition } from "./Dropdown";

export type ContextMenuItem = {
  id: string;
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  href?: string;
  external?: boolean;
  onSelect?: () => void;
};

type ContextMenuContent =
  | { elements: readonly DropdownItem[]; items?: readonly ContextMenuItem[] }
  | { elements?: readonly DropdownItem[]; items: readonly ContextMenuItem[] };

export type ContextMenuProps = ContextMenuContent & {
  children: JSX.Element;
  class?: string | ((isOpen: boolean) => string);
  disabled?: boolean;
  onClose?: () => void;
  onOpen?: () => void;
  id?: string;
  label?: string;
};

let closeActiveContextMenu: (() => void) | undefined;

const focusableItems = (menu: HTMLElement | undefined): HTMLElement[] =>
  menu
    ? Array.from(
        menu.querySelectorAll<HTMLElement>(
          "[role='menuitem']:not([aria-disabled='true']), [role='menuitemcheckbox']:not([aria-disabled='true']), button:not([disabled]), a[href]",
        ),
      ).filter((item, index, items) => items.indexOf(item) === index)
    : [];

/** Right-click menu with keyboard invocation, one-open-at-a-time behavior, and viewport clamping. */
export function ContextMenu(props: ContextMenuProps): JSX.Element {
  const generatedId = `k2b-context-${createUniqueId()}`;
  const [position, setPosition] = createSignal<{ x: number; y: number }>();
  let host: HTMLDivElement | undefined;
  let menu: HTMLDivElement | undefined;

  const isOpen = () => position() !== undefined;
  const hostClass = createMemo(() => (typeof props.class === "function" ? props.class(isOpen()) : props.class));
  const elements = (): readonly DropdownItem[] =>
    props.elements ??
    (props.items ?? []).map((item) => ({
      label: item.label,
      icon: item.icon,
      variant: item.danger ? ("danger" as const) : undefined,
      disabled: item.disabled,
      ...(item.href
        ? { href: item.href, external: item.external }
        : {
            action: () => item.onSelect?.(),
          }),
    }));

  const close = () => {
    if (!isOpen()) return;
    setPosition();
    if (closeActiveContextMenu === close) closeActiveContextMenu = undefined;
    props.onClose?.();
  };
  const focusItem = (index: number) => {
    const items = focusableItems(menu);
    if (items.length === 0) return;
    items[(index + items.length) % items.length]?.focus();
  };
  const open = (x: number, y: number) => {
    if (props.disabled) return;
    closeActiveContextMenu?.();
    const point = dropdownPosition(
      new DOMRect(x, y, 0, 0),
      { width: 232, height: Math.min(elements().length * 38 + 12, 384) },
      "bottom-right" satisfies DropdownPosition,
      { width: window.innerWidth, height: window.innerHeight },
      0,
    );
    setPosition({ x: point.left, y: point.top });
    closeActiveContextMenu = close;
    props.onOpen?.();
    queueMicrotask(() => {
      for (const item of focusableItems(menu)) {
        if (!item.hasAttribute("role")) item.setAttribute("role", "menuitem");
        item.tabIndex = -1;
      }
      focusItem(0);
    });
  };
  const keyDown = (event: KeyboardEvent) => {
    if (!isOpen()) return;
    const items = focusableItems(menu);
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(current + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusItem(event.key === "Home" ? 0 : -1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      host?.focus();
    } else if (event.key === "Tab") {
      close();
    }
  };

  onMount(() => {
    const dismiss = (event: PointerEvent) => {
      if (!isOpen() || menu?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", keyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    onCleanup(() => {
      if (closeActiveContextMenu === close) closeActiveContextMenu = undefined;
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", keyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    });
  });

  return (
    <>
      <div
        ref={host}
        id={props.id ?? generatedId}
        class={hostClass()}
        role="group"
        tabIndex={props.disabled ? undefined : 0}
        aria-disabled={props.disabled ? "true" : undefined}
        onContextMenu={(event) => {
          if (props.disabled) return;
          event.preventDefault();
          event.stopPropagation();
          open(event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (props.disabled || (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))) return;
          event.preventDefault();
          const rect = host?.getBoundingClientRect();
          if (rect) open(rect.left + 12, rect.top + 12);
        }}
      >
        {props.children}
      </div>
      <Show when={position()}>
        {(point) => (
          <Portal>
            <div
              ref={menu}
              class="k2b-ui k2b-context-menu"
              role="menu"
              aria-label={props.label ?? "Context menu"}
              style={{ left: `${point().x}px`, top: `${point().y}px` }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <DropdownItems items={elements()} close={close} />
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}

export default ContextMenu;
