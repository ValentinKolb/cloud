import { createEffect, createUniqueId, type JSX, onCleanup, onMount, type ParentProps } from "solid-js";
import { positionTooltipSurface, type TooltipPlacement } from "./tooltip-position";

export type TooltipProps = ParentProps<{
  content: JSX.Element;
  placement?: TooltipPlacement;
  delay?: number;
  disabled?: boolean;
  class?: string;
}>;

export function Tooltip(props: TooltipProps): JSX.Element {
  // Unlike Cloud's browser-only crypto.randomUUID(), Solid's unique id stays
  // stable across SSR and hydration in standalone @k2b/ssr consumers.
  const tooltipId = `k2b-tooltip-${createUniqueId()}`;
  let wrapper: HTMLSpanElement | undefined;
  let surface: HTMLSpanElement | undefined;
  let target: HTMLElement | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let dismissedUntilLeave = false;

  const clearTimer = () => {
    if (openTimer) clearTimeout(openTimer);
    openTimer = undefined;
  };

  function dismissOnEscape(event: KeyboardEvent) {
    if (event.key !== "Escape" || !surface?.matches(":popover-open")) return;
    dismissedUntilLeave = true;
    close();
  }

  function close() {
    clearTimer();
    if (surface?.matches(":popover-open")) {
      try {
        surface.hidePopover();
      } catch {
        // The surface may disconnect during cleanup.
      }
    }
    document.removeEventListener("keydown", dismissOnEscape);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close);
  }

  createEffect(() => {
    if (props.disabled) close();
  });

  const open = () => {
    clearTimer();
    if (props.disabled || dismissedUntilLeave || !surface || !target || surface.matches(":popover-open")) return;
    openTimer = setTimeout(() => {
      openTimer = undefined;
      if (props.disabled || !surface?.isConnected || !target) return;
      try {
        surface.showPopover();
      } catch {
        return;
      }
      positionTooltipSurface(surface, target, props.placement);
      document.addEventListener("keydown", dismissOnEscape);
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    }, props.delay ?? 250);
  };

  onMount(() => {
    if (!wrapper) return;
    target =
      wrapper.querySelector<HTMLElement>("button, a[href], input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])") ??
      wrapper;
    const originalDescription = target.getAttribute("aria-describedby");
    const descriptions = new Set(originalDescription?.split(/\s+/).filter(Boolean) ?? []);
    descriptions.add(tooltipId);
    target.setAttribute("aria-describedby", [...descriptions].join(" "));

    const focusOut = (event: FocusEvent) => {
      if (!wrapper?.contains(event.relatedTarget as Node | null)) {
        dismissedUntilLeave = false;
        close();
      }
    };
    const leave = () => {
      dismissedUntilLeave = false;
      close();
    };
    const pointerDown = () => {
      dismissedUntilLeave = true;
      close();
    };

    wrapper.addEventListener("pointerenter", open);
    wrapper.addEventListener("pointerleave", leave);
    wrapper.addEventListener("pointerdown", pointerDown);
    wrapper.addEventListener("focusin", open);
    wrapper.addEventListener("focusout", focusOut);

    onCleanup(() => {
      close();
      if (originalDescription) target?.setAttribute("aria-describedby", originalDescription);
      else target?.removeAttribute("aria-describedby");
      wrapper?.removeEventListener("pointerenter", open);
      wrapper?.removeEventListener("pointerleave", leave);
      wrapper?.removeEventListener("pointerdown", pointerDown);
      wrapper?.removeEventListener("focusin", open);
      wrapper?.removeEventListener("focusout", focusOut);
    });
  });

  return (
    <span
      ref={(element) => {
        wrapper = element;
      }}
      class={`k2b-tooltip-wrapper ${props.class ?? ""}`}
    >
      {props.children}
      <span
        ref={(element) => {
          surface = element;
        }}
        id={tooltipId}
        role="tooltip"
        popover="manual"
        class="k2b-tooltip"
      >
        {props.content}
      </span>
    </span>
  );
}

export type { TooltipPlacement } from "./tooltip-position";

export default Tooltip;
