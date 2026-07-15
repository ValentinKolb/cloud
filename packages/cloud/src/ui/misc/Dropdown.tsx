import { createSignal, type JSX, onCleanup, onMount } from "solid-js";

// ==========================
// Types
// ==========================

type DropdownActionBase = {
  icon?: string;
  label: string;
  variant?: "danger";
};

type DropdownActionClick = DropdownActionBase & {
  action: () => void;
  href?: never;
};

type DropdownActionLink = DropdownActionBase & {
  href: string;
  external?: boolean;
  action?: never;
};

type DropdownAction = DropdownActionClick | DropdownActionLink;

type DropdownElement = {
  element: JSX.Element | ((close: () => void) => JSX.Element);
};

type DropdownSection = {
  sectionLabel?: string;
  items: Array<DropdownAction | DropdownElement>;
};

export type DropdownItem = DropdownAction | DropdownElement | DropdownSection;

type DropdownProps = {
  trigger: JSX.Element;
  elements: DropdownItem[];
  position?:
    | "bottom-right"
    | "bottom-left"
    | "top-right"
    | "top-left"
    | "right-start"
    | (() => "bottom-right" | "bottom-left" | "top-right" | "top-left" | "right-start");
  width?: string;
  className?: string;
  triggerClass?: string;
  openOnHover?: boolean;
  /** Called when the dropdown closes (click outside, escape, or programmatic) */
  onClose?: () => void;
};

// ==========================
// Constants
// ==========================

const POSITION_STYLES: Record<string, string> = {
  "bottom-right":
    "top: anchor(bottom); left: anchor(left); margin-top: 4px;" +
    "position-try-fallbacks: --flip-block;" +
    "position-try: --flip-block { bottom: anchor(top); top: auto; margin-top: 0; margin-bottom: 4px; };",
  "bottom-left":
    "top: anchor(bottom); right: anchor(right); margin-top: 4px;" +
    "position-try-fallbacks: --flip-block-left;" +
    "position-try: --flip-block-left { bottom: anchor(top); top: auto; margin-top: 0; margin-bottom: 4px; };",
  "top-right":
    "bottom: anchor(top); left: anchor(left); margin-bottom: 4px;" +
    "position-try-fallbacks: --flip-block-down;" +
    "position-try: --flip-block-down { top: anchor(bottom); bottom: auto; margin-bottom: 0; margin-top: 4px; };",
  "top-left":
    "bottom: anchor(top); right: anchor(right); margin-bottom: 4px;" +
    "position-try-fallbacks: --flip-block-down-left;" +
    "position-try: --flip-block-down-left { top: anchor(bottom); bottom: auto; margin-bottom: 0; margin-top: 4px; };",
  "right-start":
    "top: anchor(top); left: anchor(right); margin-left: 6px;" +
    "position-try-fallbacks: --flip-inline-start;" +
    "position-try: --flip-inline-start { right: anchor(left); left: auto; margin-left: 0; margin-right: 6px; };",
};

const ITEM_BASE_CLASSES = "menu-item";

// ==========================
// Component
// ==========================

/** Accessible dropdown menu with popover light-dismiss and CSS anchor positioning. */
export default function Dropdown(props: DropdownProps) {
  const width = props.width ?? "w-48";
  const anchor = `--dd-${crypto.randomUUID()}`;
  const menuId = `dropdown-${crypto.randomUUID()}`;
  const [isOpen, setIsOpen] = createSignal(false);
  let triggerRef!: HTMLSpanElement;
  let popoverRef!: HTMLDivElement;
  let hoverCloseTimer: number | undefined;

  const triggerFocusTarget = () =>
    triggerRef.querySelector<HTMLElement>("button, a[href], input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])") ??
    triggerRef;

  const syncTriggerAria = (open: boolean) => {
    const target = triggerFocusTarget();
    if (target === triggerRef) {
      target.setAttribute("role", "button");
      target.tabIndex = 0;
    } else if (!target.hasAttribute("tabindex") && target.getAttribute("role") === "button") {
      target.tabIndex = 0;
    }
    target.setAttribute("aria-haspopup", "menu");
    target.setAttribute("aria-expanded", String(open));
    target.setAttribute("aria-controls", menuId);
  };

  onMount(() => {
    const target = triggerFocusTarget();
    const handleClick = (event: MouseEvent) => {
      event.stopPropagation();
      if (isOpen()) close(false);
      else open();
    };

    syncTriggerAria(false);
    target.addEventListener("click", handleClick);
    target.addEventListener("keydown", handleTriggerKeyDown);

    const cancelHoverClose = () => {
      if (hoverCloseTimer !== undefined) window.clearTimeout(hoverCloseTimer);
      hoverCloseTimer = undefined;
    };
    const scheduleHoverClose = () => {
      cancelHoverClose();
      hoverCloseTimer = window.setTimeout(() => close(false), 120);
    };
    const openFromHover = () => {
      cancelHoverClose();
      if (!isOpen()) open(false);
    };
    if (props.openOnHover) {
      triggerRef.addEventListener("pointerenter", openFromHover);
      triggerRef.addEventListener("pointerleave", scheduleHoverClose);
      popoverRef.addEventListener("pointerenter", cancelHoverClose);
      popoverRef.addEventListener("pointerleave", scheduleHoverClose);
    }

    onCleanup(() => {
      cancelHoverClose();
      target.removeEventListener("click", handleClick);
      target.removeEventListener("keydown", handleTriggerKeyDown);
      triggerRef.removeEventListener("pointerenter", openFromHover);
      triggerRef.removeEventListener("pointerleave", scheduleHoverClose);
      popoverRef.removeEventListener("pointerenter", cancelHoverClose);
      popoverRef.removeEventListener("pointerleave", scheduleHoverClose);
    });
  });

  const menuItems = () => Array.from(popoverRef?.querySelectorAll<HTMLElement>("[role='menuitem'], button:not([disabled]), a[href]") ?? []);

  const prepareMenuItems = () => {
    for (const item of menuItems()) {
      if (!item.hasAttribute("role")) item.setAttribute("role", "menuitem");
      item.tabIndex = -1;
    }
  };

  const focusItem = (index: number) => {
    const items = menuItems();
    if (items.length === 0) return;
    items[Math.max(0, Math.min(index, items.length - 1))]?.focus();
  };

  const close = (restoreFocus = true): void => {
    if (popoverRef?.matches(":popover-open")) popoverRef.hidePopover();
    if (restoreFocus) queueMicrotask(() => triggerFocusTarget().focus());
  };

  const getPositionStyle = (): string => {
    const pos = typeof props.position === "function" ? props.position() : (props.position ?? "bottom-right");
    return POSITION_STYLES[pos] ?? POSITION_STYLES["bottom-right"]!;
  };

  const getVariantClasses = (variant?: "danger"): string =>
    variant === "danger" ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300";

  const open = (focus: "first" | "last" | false = "first") => {
    const base = `position-anchor: ${anchor}; position: fixed; inset: unset; margin: 0; scrollbar-gutter: auto;`;
    popoverRef.setAttribute("style", props.className ? base : `${base} ${getPositionStyle()}`);
    popoverRef.showPopover();
    queueMicrotask(() => {
      prepareMenuItems();
      if (focus) focusItem(focus === "first" ? 0 : menuItems().length - 1);
    });
  };

  const handleTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    if (isOpen()) {
      focusItem(event.key === "ArrowUp" ? menuItems().length - 1 : 0);
      return;
    }
    open(event.key === "ArrowUp" ? "last" : "first");
  };

  const handleMenuKeyDown = (event: KeyboardEvent) => {
    const items = menuItems();
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(currentIndex >= items.length - 1 ? 0 : currentIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(currentIndex <= 0 ? items.length - 1 : currentIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(items.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  const renderItem = (item: DropdownAction | DropdownElement): JSX.Element => {
    if ("element" in item) {
      return typeof item.element === "function" ? item.element(close) : item.element;
    }

    const classes = `${ITEM_BASE_CLASSES} ${getVariantClasses(item.variant)}`;
    const content = (
      <>
        {item.icon && <i class={item.icon} />}
        <span>{item.label}</span>
      </>
    );

    // Link variant
    if ("href" in item && item.href) {
      return (
        <a
          href={item.href}
          target={item.external ? "_blank" : undefined}
          rel={item.external ? "noopener noreferrer" : undefined}
          role="menuitem"
          tabIndex={-1}
          class={classes}
          onClick={() => close()}
        >
          {content}
        </a>
      );
    }

    // Button variant
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        class={classes}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          (item as DropdownActionClick).action();
          close();
        }}
      >
        {content}
      </button>
    );
  };

  return (
    <>
      <span class={`inline-flex ${props.triggerClass ?? ""}`} ref={triggerRef} style={`anchor-name: ${anchor}`}>
        {props.trigger}
      </span>

      <div
        ref={(el) => {
          popoverRef = el;
          el.addEventListener("toggle", (e) => {
            const newState = (e as ToggleEvent).newState;
            const wasOpen = isOpen();
            setIsOpen(newState === "open");
            syncTriggerAria(newState === "open");
            // Call onClose when transitioning from open to closed
            if (wasOpen && newState === "closed" && props.onClose) {
              props.onClose();
            }
          });
        }}
        popover="auto"
        id={menuId}
        role="menu"
        aria-label="Dropdown menu"
        onKeyDown={handleMenuKeyDown}
        class={`${width} dropdown-menu-surface max-h-[min(24rem,80dvh)] overflow-y-auto p-1 ${props.className ?? ""}`}
      >
        {props.elements.map((item, i) =>
          "items" in item ? (
            <div class={i > 0 ? "menu-section" : undefined}>
              {item.sectionLabel && <div class="menu-label">{item.sectionLabel}</div>}
              {item.items.map(renderItem)}
            </div>
          ) : (
            renderItem(item)
          ),
        )}
      </div>
    </>
  );
}
