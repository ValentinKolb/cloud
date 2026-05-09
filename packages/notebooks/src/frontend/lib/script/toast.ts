/**
 * Tiny inline toast helper for `kit.ui.toast(...)`.
 *
 * Why hand-rolled instead of `prompts.alert` or the SolidJS UI lib:
 *  - `prompts.*` produces blocking modals — semantically wrong for a
 *    "transient notification."
 *  - The platform doesn't currently ship a real toast component;
 *    when it does (Phase 3+), this file disappears and the
 *    `kit.ui.toast` callsite swaps to the platform surface.
 *  - This is plain DOM (no SolidJS) so it works in any Phase 1
 *    runtime context (CM6 widget, read-mode enhancer, future
 *    Web Worker proxy, …).
 *
 * Behaviour:
 *  - Stacks vertically bottom-right, oldest at the top (so new
 *    arrivals push existing toasts up — matches Slack/macOS).
 *  - Auto-dismisses after `TOAST_DURATION_MS`. Click dismisses early.
 *  - Caps the visible stack at `MAX_VISIBLE_TOASTS`; older toasts
 *    are hard-removed on overflow to keep the screen clear.
 */

const TOAST_DURATION_MS = 3000;
const MAX_VISIBLE_TOASTS = 5;
const CONTAINER_ID = "kit-toast-container";

/** Lazily-mount the fixed-position container. Idempotent — repeated
 *  calls return the same node. */
const ensureContainer = (): HTMLElement => {
  let container = document.getElementById(CONTAINER_ID);
  if (container) return container;
  container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.className =
    "fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none " +
    // `items-end` so toasts shrink to content width and stack flush
    // right; `pointer-events-none` so the (mostly transparent) gap
    // between toasts doesn't intercept clicks on the page beneath.
    "items-end max-w-sm";
  document.body.appendChild(container);
  return container;
};

/** Show a transient notification. Returns nothing — fire-and-forget. */
export const showToast = (message: string): void => {
  const container = ensureContainer();

  const toast = document.createElement("div");
  toast.className =
    "pointer-events-auto cursor-pointer " +
    "px-3 py-2 rounded-md text-sm shadow-lg " +
    "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 " +
    // Slide-in from the right + fade. The transition is removed
    // when we dismiss so the exit animation can re-arm via
    // re-applying `opacity-0`.
    "transition-all duration-200 ease-out " +
    "translate-x-2 opacity-0";
  toast.textContent = message;

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    toast.classList.remove("translate-x-0", "opacity-100");
    toast.classList.add("translate-x-2", "opacity-0");
    // Match the CSS transition duration so the node lingers long
    // enough for the exit animation to finish.
    setTimeout(() => toast.remove(), 200);
  };

  toast.addEventListener("click", dismiss);
  container.appendChild(toast);

  // Trim overflow: when the stack grows past the cap, drop the
  // oldest. We do this BEFORE the new toast animates in so the
  // remove doesn't visually flicker the new arrival.
  while (container.children.length > MAX_VISIBLE_TOASTS) {
    container.firstElementChild?.remove();
  }

  // Animate in on next frame — initial state is `opacity-0
  // translate-x-2` (set above); flipping after a microtask ensures
  // the browser renders the initial frame so the transition kicks in.
  requestAnimationFrame(() => {
    toast.classList.remove("translate-x-2", "opacity-0");
    toast.classList.add("translate-x-0", "opacity-100");
  });

  setTimeout(dismiss, TOAST_DURATION_MS);
};
