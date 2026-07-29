import { createContext, createEffect, createSignal, createUniqueId, For, type JSX, onCleanup, onMount, Show, useContext } from "solid-js";

export type DropdownPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "right-start";

export type DropdownActionBase = {
  icon?: string;
  label: string;
  variant?: "danger";
  disabled?: boolean;
};

export type DropdownAction =
  | (DropdownActionBase & {
      action: () => void;
      href?: never;
      external?: never;
    })
  | (DropdownActionBase & {
      href: string;
      external?: boolean;
      action?: never;
    });

export type DropdownElement = {
  element: JSX.Element | ((close: () => void) => JSX.Element);
};

export type DropdownSection = {
  sectionLabel?: string;
  items: readonly (DropdownAction | DropdownElement)[];
};

export type DropdownItem = DropdownAction | DropdownElement | DropdownSection;

export type DropdownProps = {
  trigger: JSX.Element;
  elements?: readonly DropdownItem[];
  children?: JSX.Element;
  position?: DropdownPosition | (() => DropdownPosition);
  /**
   * Menu width as a CSS length, for example `"10rem"`. Defaults to `12rem`.
   * This is not a class name: the package ships no utility classes, so a
   * standalone consumer has nothing to pass one from.
   */
  width?: string;
  className?: string;
  class?: string;
  triggerClass?: string;
  openOnHover?: boolean;
  onClose?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  label?: string;
  align?: "start" | "end";
};

export type DropdownItemProps = {
  children: JSX.Element;
  icon?: string;
  disabled?: boolean;
  danger?: boolean;
  variant?: "danger";
  href?: string;
  external?: boolean;
  onSelect?: () => void;
  class?: string;
};

type MenuContextValue = {
  close: (restoreFocus?: boolean) => void;
};

const MenuContext = createContext<MenuContextValue>();

const actionableItems = (menu: HTMLElement | undefined): HTMLElement[] =>
  menu
    ? Array.from(
        menu.querySelectorAll<HTMLElement>(
          [
            "[role='menuitem']:not([aria-disabled='true'])",
            "[role='menuitemcheckbox']:not([aria-disabled='true'])",
            "[role='menuitemradio']:not([aria-disabled='true'])",
          ].join(", "),
        ),
      )
    : [];

const focusMenuItem = (menu: HTMLElement | undefined, index: number): void => {
  const items = actionableItems(menu);
  if (items.length === 0) return;
  items[(index + items.length) % items.length]?.focus();
};

export const dropdownPosition = (
  trigger: DOMRect,
  menu: Pick<DOMRect, "width" | "height">,
  position: DropdownPosition,
  viewport: { width: number; height: number },
  gap = 4,
): { left: number; top: number } => {
  let left = trigger.left;
  let top = trigger.bottom + gap;

  if (position === "bottom-left" || position === "top-left") left = trigger.right - menu.width;
  if (position === "top-right" || position === "top-left") top = trigger.top - menu.height - gap;
  if (position === "right-start") {
    left = trigger.right + gap;
    top = trigger.top;
  }

  return {
    left: Math.max(8, Math.min(left, viewport.width - menu.width - 8)),
    top: Math.max(8, Math.min(top, viewport.height - menu.height - 8)),
  };
};

export function DropdownItem(props: DropdownItemProps): JSX.Element {
  const menu = useContext(MenuContext);
  const danger = () => props.danger || props.variant === "danger";
  const content = (
    <>
      <Show when={props.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
      <span>{props.children}</span>
    </>
  );

  return (
    <Show
      when={!props.disabled ? props.href : undefined}
      fallback={
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          class={`k2b-dropdown__item ${props.class ?? ""}`}
          data-danger={danger() ? "true" : undefined}
          disabled={props.disabled}
          aria-disabled={props.disabled ? "true" : undefined}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onSelect?.();
            menu?.close();
          }}
        >
          {content}
        </button>
      }
    >
      {(href) => (
        <a
          href={href()}
          target={props.external ? "_blank" : undefined}
          rel={props.external ? "noopener noreferrer" : undefined}
          role="menuitem"
          tabIndex={-1}
          class={`k2b-dropdown__item ${props.class ?? ""}`}
          data-danger={danger() ? "true" : undefined}
          onClick={() => {
            props.onSelect?.();
            menu?.close(false);
          }}
        >
          {content}
        </a>
      )}
    </Show>
  );
}

export function DropdownItems(props: { items: readonly DropdownItem[]; close: (restoreFocus?: boolean) => void }): JSX.Element {
  const renderItem = (item: DropdownAction | DropdownElement): JSX.Element => {
    if ("element" in item) return typeof item.element === "function" ? item.element(props.close) : item.element;
    return (
      <DropdownItem
        icon={item.icon}
        variant={item.variant}
        disabled={item.disabled}
        href={"href" in item ? item.href : undefined}
        external={"external" in item ? item.external : undefined}
        onSelect={"action" in item ? item.action : undefined}
      >
        {item.label}
      </DropdownItem>
    );
  };

  return (
    <MenuContext.Provider value={{ close: props.close }}>
      <For each={props.items}>
        {(item, index) => (
          <Show when={"items" in item} fallback={renderItem(item as DropdownAction | DropdownElement)}>
            <div
              class="k2b-dropdown__section"
              data-divided={index() > 0 ? "true" : undefined}
              role="group"
              aria-label={(item as DropdownSection).sectionLabel ?? "Actions"}
            >
              <Show when={(item as DropdownSection).sectionLabel}>{(label) => <div class="k2b-dropdown__label">{label()}</div>}</Show>
              <For each={(item as DropdownSection).items}>{renderItem}</For>
            </div>
          </Show>
        )}
      </For>
    </MenuContext.Provider>
  );
}

/** Accessible top-layer menu with keyboard navigation, light dismiss, and viewport-aware positioning. */
export function Dropdown(props: DropdownProps): JSX.Element {
  const id = createUniqueId().replace(/[^a-zA-Z0-9_-]/g, "-");
  const menuId = `k2b-dropdown-${id}`;
  const [internalOpen, setInternalOpen] = createSignal(false);
  let triggerRef: HTMLSpanElement | undefined;
  let triggerContentRef: HTMLSpanElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  let mounted = false;
  let hoverCloseTimer: ReturnType<typeof setTimeout> | undefined;
  let managedTrigger: HTMLElement | undefined;
  let triggerAttributes: Map<string, string | null> | undefined;
  let triggerWasDisabled = false;
  let viewportListenersAttached = false;

  const isOpen = () => props.open ?? internalOpen();
  const triggerTarget = () =>
    triggerContentRef?.querySelector<HTMLElement>(
      "button, a[href], input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])",
    ) ?? triggerContentRef;
  const position = (): DropdownPosition =>
    typeof props.position === "function" ? props.position() : (props.position ?? (props.align === "end" ? "bottom-left" : "bottom-right"));

  const restoreAttribute = (target: HTMLElement, name: string, value: string | null): void => {
    if (value === null) target.removeAttribute(name);
    else target.setAttribute(name, value);
  };

  const syncTrigger = (open: boolean) => {
    const target = managedTrigger ?? triggerTarget();
    if (!target) return;
    const nativeButton = target.matches("button") ? (target as HTMLButtonElement) : undefined;
    const originallyDisabled = triggerAttributes?.get("aria-disabled") === "true" || triggerWasDisabled;
    const disabled = Boolean(props.disabled || originallyDisabled);

    if (target === triggerContentRef) {
      target.setAttribute("role", "button");
      target.tabIndex = disabled ? -1 : 0;
    } else if (disabled) {
      target.tabIndex = -1;
    } else if (target.getAttribute("role") === "button" && triggerAttributes?.get("tabindex") === null) {
      target.tabIndex = 0;
    } else if (triggerAttributes) {
      restoreAttribute(target, "tabindex", triggerAttributes.get("tabindex") ?? null);
    }
    if (nativeButton) nativeButton.disabled = triggerWasDisabled || Boolean(props.disabled);
    target.setAttribute("aria-haspopup", "menu");
    target.setAttribute("aria-expanded", String(open));
    target.setAttribute("aria-controls", menuId);
    target.setAttribute("aria-disabled", String(disabled));
    if (props.label && !target.getAttribute("aria-label")) target.setAttribute("aria-label", props.label);
  };

  const place = () => {
    if (!triggerRef || !menuRef || props.className) return;
    const rect = dropdownPosition(triggerRef.getBoundingClientRect(), menuRef.getBoundingClientRect(), position(), {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    menuRef.style.left = `${rect.left}px`;
    menuRef.style.top = `${rect.top}px`;
  };

  const reposition = () => {
    if (isOpen()) place();
  };
  const attachViewportListeners = () => {
    if (viewportListenersAttached) return;
    viewportListenersAttached = true;
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
  };
  const detachViewportListeners = () => {
    if (!viewportListenersAttached) return;
    viewportListenersAttached = false;
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
  };

  const close = (restoreFocus = true) => {
    if (menuRef?.matches(":popover-open")) menuRef.hidePopover();
    detachViewportListeners();
    if (restoreFocus) queueMicrotask(() => triggerTarget()?.focus());
  };

  const open = (focus: "first" | "last" | false = "first") => {
    if (props.disabled || !menuRef || menuRef.matches(":popover-open")) return;
    menuRef.showPopover();
    attachViewportListeners();
    place();
    queueMicrotask(() => {
      if (focus) focusMenuItem(menuRef, focus === "first" ? 0 : -1);
    });
  };

  const requestOpen = (next: boolean, focus: "first" | "last" | false = "first") => {
    if (props.open !== undefined) {
      props.onOpenChange?.(next);
      return;
    }
    if (next) open(focus);
    else close(false);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent) => {
    if (!["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (isOpen()) {
      focusMenuItem(menuRef, event.key === "ArrowUp" ? -1 : 0);
      return;
    }
    requestOpen(true, event.key === "ArrowUp" ? "last" : "first");
  };

  const handleMenuKeyDown = (event: KeyboardEvent) => {
    const items = actionableItems(menuRef);
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem(menuRef, current + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusMenuItem(menuRef, event.key === "Home" ? 0 : -1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      requestOpen(false);
      if (props.open !== undefined) triggerTarget()?.focus();
    } else if (event.key === "Tab") {
      const target = event.target;
      if (target instanceof HTMLElement && target.matches("[role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio']")) {
        requestOpen(false);
      }
    }
  };

  createEffect(() => {
    const controlled = props.open;
    if (!mounted || controlled === undefined || !menuRef) return;
    if (controlled && !menuRef.matches(":popover-open")) open(false);
    if (!controlled && menuRef.matches(":popover-open")) close(false);
  });

  // `syncTrigger` writes the trigger's tabIndex from `props.disabled`, so it has to
  // re-run when that prop flips; otherwise a disabled trigger stays tabbable.
  createEffect(() => {
    const disabled = props.disabled;
    if (!mounted) return;
    if (disabled) close(false);
    syncTrigger(isOpen());
  });

  onMount(() => {
    mounted = true;
    const target = triggerTarget();
    if (!target || !triggerRef || !menuRef) return;

    const handleClick = (event: MouseEvent) => {
      event.stopPropagation();
      if (props.disabled) {
        event.preventDefault();
        return;
      }
      requestOpen(!isOpen());
    };
    const cancelHoverClose = () => {
      if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
      hoverCloseTimer = undefined;
    };
    const scheduleHoverClose = () => {
      cancelHoverClose();
      hoverCloseTimer = setTimeout(() => requestOpen(false), 120);
    };
    const openFromHover = () => {
      cancelHoverClose();
      if (!isOpen()) requestOpen(true, false);
    };
    managedTrigger = target;
    triggerAttributes = new Map(
      ["role", "tabindex", "aria-haspopup", "aria-expanded", "aria-controls", "aria-disabled", "aria-label"].map((name) => [
        name,
        target.getAttribute(name),
      ]),
    );
    triggerWasDisabled = target.matches("button") ? (target as HTMLButtonElement).disabled : false;
    syncTrigger(false);
    target.addEventListener("click", handleClick);
    target.addEventListener("keydown", handleTriggerKeyDown);
    if (props.openOnHover) {
      triggerRef.addEventListener("pointerenter", openFromHover);
      triggerRef.addEventListener("pointerleave", scheduleHoverClose);
      menuRef.addEventListener("pointerenter", cancelHoverClose);
      menuRef.addEventListener("pointerleave", scheduleHoverClose);
    }
    if (props.open) open(false);

    onCleanup(() => {
      cancelHoverClose();
      detachViewportListeners();
      target.removeEventListener("click", handleClick);
      target.removeEventListener("keydown", handleTriggerKeyDown);
      triggerRef?.removeEventListener("pointerenter", openFromHover);
      triggerRef?.removeEventListener("pointerleave", scheduleHoverClose);
      menuRef?.removeEventListener("pointerenter", cancelHoverClose);
      menuRef?.removeEventListener("pointerleave", scheduleHoverClose);
      for (const [name, value] of triggerAttributes ?? []) restoreAttribute(target, name, value);
      if (target.matches("button")) (target as HTMLButtonElement).disabled = triggerWasDisabled;
    });
  });

  return (
    <span class={`k2b-dropdown ${props.class ?? ""}`} ref={triggerRef}>
      <span class={`k2b-dropdown__trigger ${props.triggerClass ?? ""}`} ref={triggerContentRef}>
        {props.trigger}
      </span>
      <div
        ref={(element) => {
          menuRef = element;
          element.addEventListener("toggle", (event) => {
            const nextOpen = (event as ToggleEvent).newState === "open";
            const wasOpen = internalOpen();
            setInternalOpen(nextOpen);
            if (nextOpen) attachViewportListeners();
            else detachViewportListeners();
            syncTrigger(nextOpen);
            if (props.open === undefined || props.open !== nextOpen) props.onOpenChange?.(nextOpen);
            if (wasOpen && !nextOpen) props.onClose?.();
            if (!nextOpen && props.open === true) {
              queueMicrotask(() => {
                if (props.open === true) open(false);
              });
            }
          });
        }}
        id={menuId}
        popover="auto"
        role="menu"
        aria-label={props.label ?? "Dropdown menu"}
        class={`k2b-dropdown__menu ${props.className ?? ""}`}
        style={props.width ? { "--k2b-dropdown-width": props.width } : undefined}
        data-position={position()}
        onKeyDown={handleMenuKeyDown}
      >
        <Show when={props.elements} fallback={<MenuContext.Provider value={{ close }}>{props.children}</MenuContext.Provider>}>
          {(items) => <DropdownItems items={items()} close={close} />}
        </Show>
      </div>
    </span>
  );
}

export default Dropdown;
