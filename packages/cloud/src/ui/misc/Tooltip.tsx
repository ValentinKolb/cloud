import { type JSX, onCleanup, onMount, type ParentProps } from "solid-js";

export type TooltipPlacement = "top" | "bottom";

export type TooltipProps = ParentProps<{
  content: JSX.Element;
  placement?: TooltipPlacement;
  delay?: number;
  disabled?: boolean;
  class?: string;
}>;

const VIEWPORT_PADDING = 8;
const TRIGGER_GAP = 6;

/** Non-interactive hint for an existing control. Use a popover when the content contains actions. */
export default function Tooltip(props: TooltipProps) {
  const tooltipId = `tooltip-${crypto.randomUUID()}`;
  let wrapperRef!: HTMLSpanElement;
  let tooltipRef!: HTMLDivElement;
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
    if (tooltipRef?.matches(":popover-open")) tooltipRef.hidePopover();
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close);
  };

  const position = () => {
    if (!tooltipRef.matches(":popover-open")) return;
    const triggerRect = wrapperRef.getBoundingClientRect();
    const tooltipRect = tooltipRef.getBoundingClientRect();
    const topPosition = triggerRect.top - tooltipRect.height - TRIGGER_GAP;
    const bottomPosition = triggerRect.bottom + TRIGGER_GAP;
    const preferTop = (props.placement ?? "top") === "top";
    const topFits = topPosition >= VIEWPORT_PADDING;
    const bottomFits = bottomPosition + tooltipRect.height <= window.innerHeight - VIEWPORT_PADDING;
    const useTop = preferTop ? topFits || !bottomFits : !bottomFits && topFits;
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2, window.innerWidth - tooltipRect.width - VIEWPORT_PADDING),
    );

    tooltipRef.style.left = `${Math.round(left)}px`;
    tooltipRef.style.top = `${Math.round(useTop ? topPosition : bottomPosition)}px`;
    tooltipRef.dataset.placement = useTop ? "top" : "bottom";
  };

  const open = () => {
    clearOpenTimer();
    if (props.disabled || dismissedUntilLeave || tooltipRef.matches(":popover-open")) return;
    openTimer = setTimeout(() => {
      openTimer = undefined;
      if (props.disabled || !tooltipRef.isConnected) return;
      tooltipRef.showPopover();
      position();
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    }, props.delay ?? 400);
  };

  onMount(() => {
    const target = trigger();
    const originalDescription = target.getAttribute("aria-describedby");
    const descriptions = new Set(originalDescription?.split(/\s+/).filter(Boolean) ?? []);
    descriptions.add(tooltipId);
    target.setAttribute("aria-describedby", [...descriptions].join(" "));

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
      if (originalDescription) target.setAttribute("aria-describedby", originalDescription);
      else target.removeAttribute("aria-describedby");
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
      <div ref={tooltipRef} id={tooltipId} role="tooltip" popover="manual" class="tooltip-surface">
        {props.content}
      </div>
    </span>
  );
}
