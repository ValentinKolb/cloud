import { type JSX, onCleanup, onMount, type ParentProps } from "solid-js";
import { positionTooltipSurface, type TooltipPlacement } from "./tooltip-position";

export type { TooltipPlacement } from "./tooltip-position";

export type TooltipProps = ParentProps<{
  content: JSX.Element;
  placement?: TooltipPlacement;
  delay?: number;
  disabled?: boolean;
  class?: string;
}>;

/** Non-interactive hint for an existing control. Use a popover when the content contains actions. */
export default function Tooltip(props: TooltipProps) {
  const tooltipId = `tooltip-${crypto.randomUUID()}`;
  let wrapperRef!: HTMLSpanElement;
  let tooltipRef!: HTMLSpanElement;
  let targetRef!: HTMLElement;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let dismissedUntilLeave = false;

  const trigger = () =>
    wrapperRef.querySelector<HTMLElement>("button, a[href], input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])") ??
    wrapperRef;

  const clearOpenTimer = () => {
    if (openTimer) clearTimeout(openTimer);
    openTimer = undefined;
  };

  const close = () => {
    clearOpenTimer();
    try {
      if (tooltipRef?.matches(":popover-open")) tooltipRef.hidePopover();
    } catch {
      // A disconnect or competing close can race with the Popover API.
    }
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close);
  };

  const position = () => {
    if (!tooltipRef.matches(":popover-open")) return;
    positionTooltipSurface(tooltipRef, targetRef, props.placement);
  };

  const open = () => {
    clearOpenTimer();
    if (props.disabled || dismissedUntilLeave || tooltipRef.matches(":popover-open")) return;
    openTimer = setTimeout(() => {
      openTimer = undefined;
      if (props.disabled || !tooltipRef.isConnected) return;
      try {
        tooltipRef.showPopover();
      } catch {
        return;
      }
      position();
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    }, props.delay ?? 250);
  };

  onMount(() => {
    targetRef = trigger();
    const originalDescription = targetRef.getAttribute("aria-describedby");
    const descriptions = new Set(originalDescription?.split(/\s+/).filter(Boolean) ?? []);
    descriptions.add(tooltipId);
    targetRef.setAttribute("aria-describedby", [...descriptions].join(" "));

    const handleFocusOut = (event: FocusEvent) => {
      if (!wrapperRef.contains(event.relatedTarget as Node | null)) {
        dismissedUntilLeave = false;
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissedUntilLeave = true;
        close();
      }
    };
    const handlePointerLeave = () => {
      dismissedUntilLeave = false;
      close();
    };
    const handlePointerDown = () => {
      dismissedUntilLeave = true;
      close();
    };

    wrapperRef.addEventListener("pointerenter", open);
    wrapperRef.addEventListener("pointerleave", handlePointerLeave);
    wrapperRef.addEventListener("pointerdown", handlePointerDown);
    wrapperRef.addEventListener("focusin", open);
    wrapperRef.addEventListener("focusout", handleFocusOut);
    wrapperRef.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      close();
      if (originalDescription) targetRef.setAttribute("aria-describedby", originalDescription);
      else targetRef.removeAttribute("aria-describedby");
      wrapperRef.removeEventListener("pointerenter", open);
      wrapperRef.removeEventListener("pointerleave", handlePointerLeave);
      wrapperRef.removeEventListener("pointerdown", handlePointerDown);
      wrapperRef.removeEventListener("focusin", open);
      wrapperRef.removeEventListener("focusout", handleFocusOut);
      wrapperRef.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <span ref={wrapperRef} class={`inline-flex ${props.class ?? ""}`}>
      {props.children}
      <span ref={tooltipRef} id={tooltipId} role="tooltip" popover="manual" class="tooltip-surface">
        {props.content}
      </span>
    </span>
  );
}
