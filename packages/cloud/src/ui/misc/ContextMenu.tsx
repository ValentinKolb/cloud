import type { JSX, ParentProps } from "solid-js";
import { createMemo, createSignal, onCleanup, onMount, children as resolveChildren, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { DropdownItem } from "./Dropdown";

const [openMenuId, setOpenMenuId] = createSignal<string | null>(null);

type ContextMenuAction = Extract<DropdownItem, { label: string }>;
type ContextMenuSection = Extract<DropdownItem, { items: unknown }>;
type ContextMenuElement = Extract<DropdownItem, { element: unknown }>;

export type ContextMenuProps = ParentProps<{
  children: JSX.Element;
  elements: DropdownItem[];
  class?: string | ((isOpen: boolean) => string);
  disabled?: boolean;
  onClose?: () => void;
  onOpen?: () => void;
  id?: string;
}>;

const ITEM_BASE_CLASSES = "menu-item";

const getVariantClasses = (variant?: "danger") =>
  variant === "danger" ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300";

const isSection = (item: DropdownItem): item is ContextMenuSection => "items" in item;
const isElement = (item: DropdownItem): item is ContextMenuElement => "element" in item;

const getMenuItems = (menu: HTMLDivElement | undefined) =>
  menu ? Array.from(menu.querySelectorAll<HTMLElement>("[role='menuitem']")) : [];

export default function ContextMenu(props: ContextMenuProps) {
  const id = props.id ?? `ctx-${crypto.randomUUID()}`;
  const [coords, setCoords] = createSignal({ x: 0, y: 0 });
  let menuRef: HTMLDivElement | undefined;
  let hostRef: HTMLDivElement | undefined;

  const isOpen = () => openMenuId() === id;
  const hostClass = createMemo(() => (typeof props.class === "function" ? props.class(isOpen()) : props.class));
  const content = resolveChildren(() => props.children);

  const close = () => {
    if (openMenuId() !== id) return;
    setOpenMenuId(null);
    props.onClose?.();
  };

  const focusItem = (index: number) => {
    const items = getMenuItems(menuRef);
    if (items.length === 0) return;
    const next = Math.max(0, Math.min(index, items.length - 1));
    items[next]?.focus();
  };

  const open = (event: MouseEvent) => {
    if (props.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    setCoords({ x: event.clientX, y: event.clientY });
    if (openMenuId() !== id) {
      setOpenMenuId(id);
      props.onOpen?.();
    }
    queueMicrotask(() => focusItem(0));
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!isOpen()) return;
    const items = getMenuItems(menuRef);
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        hostRef?.focus();
        break;
      case "ArrowDown":
        event.preventDefault();
        focusItem(currentIndex + 1);
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
      case "Tab":
        close();
        break;
    }
  };

  onMount(() => {
    const handlePointer = (event: MouseEvent) => {
      if (!isOpen()) return;
      const target = event.target;
      if (target instanceof Node && (menuRef?.contains(target) || hostRef?.contains(target))) return;
      close();
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("contextmenu", handlePointer);
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("contextmenu", handlePointer);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  const renderAction = (item: ContextMenuAction) => {
    const classes = `${ITEM_BASE_CLASSES} ${getVariantClasses(item.variant)}`;
    const content = (
      <>
        {item.icon && <i class={item.icon} />}
        <span>{item.label}</span>
      </>
    );

    if ("href" in item && item.href) {
      return (
        <a
          href={item.href}
          target={item.external ? "_blank" : undefined}
          rel={item.external ? "noopener noreferrer" : undefined}
          role="menuitem"
          tabIndex={-1}
          class={classes}
          onClick={close}
        >
          {content}
        </a>
      );
    }

    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        class={classes}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if ("action" in item && item.action) {
            item.action();
          }
          close();
        }}
      >
        {content}
      </button>
    );
  };

  return (
    <>
      <div ref={hostRef} role="group" class={hostClass()} onContextMenu={open}>
        {content()}
      </div>

      <Show when={isOpen()}>
        <Portal>
          <div
            ref={menuRef}
            role="menu"
            aria-label="Context menu"
            class="context-menu-surface fixed z-50 w-52 max-w-[min(22rem,calc(100vw-1rem))] overflow-y-auto p-1 text-zinc-900 backdrop-blur-sm dark:text-zinc-100"
            style={{
              left: `${Math.min(coords().x, window.innerWidth - 220)}px`,
              top: `${Math.min(coords().y, window.innerHeight - 320)}px`,
            }}
          >
            {props.elements.map((item, index) =>
              isSection(item) ? (
                <div class={index > 0 ? "menu-section" : undefined}>
                  <Show when={item.sectionLabel}>
                    <div class="menu-label">{item.sectionLabel}</div>
                  </Show>
                  {item.items.map((sectionItem) =>
                    isElement(sectionItem)
                      ? typeof sectionItem.element === "function"
                        ? sectionItem.element(close)
                        : sectionItem.element
                      : renderAction(sectionItem),
                  )}
                </div>
              ) : isElement(item) ? (
                typeof item.element === "function" ? (
                  item.element(close)
                ) : (
                  item.element
                )
              ) : (
                renderAction(item)
              ),
            )}
          </div>
        </Portal>
      </Show>
    </>
  );
}
