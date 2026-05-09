/**
 * Toast — transient bottom-right notifications.
 *
 * Sits next to `prompts` as the platform's lightweight messaging
 * surface: where `prompts.alert/confirm/form` are blocking modals,
 * `toast()` is fire-and-forget feedback that the user doesn't have
 * to dismiss. Three visual variants (`default` blue, `success` green,
 * `error` red) cover the common cases; `iconClass` overrides the
 * variant default when callers want something specific.
 *
 * Usage
 * -----
 * ```ts
 * import { toast } from "@valentinkolb/cloud/ui";
 *
 * toast("Note saved");                                  // default (blue)
 * toast.success("Note saved");                          // green
 * toast.error("Save failed");                           // red
 * toast("Heads up", { duration: 5000, iconClass: "ti-bell" });
 *
 * const t = toast("Uploading…", { duration: 0 });       // sticky
 * t.update("Uploading 50%");                            // mutate in place
 * t.update("Done", { variant: "success", duration: 2000 });
 *
 * toast.dismissAll();                                    // e.g. on route change
 * ```
 *
 * SSR-safe: every entry point bails when `document` is unavailable.
 */

export type ToastVariant = "default" | "success" | "error";

export type ToastOptions = {
  /** Visual style. Default `"default"` (blue). */
  variant?: ToastVariant;
  /** Auto-dismiss after this many ms. Default `3000`. `0` = sticky
   *  (only manual `t.dismiss()` removes it). */
  duration?: number;
  /** `ti-…` icon class to override the variant default. */
  iconClass?: string;
};

export type ToastHandle = {
  /** Animate out and remove. No-op if already dismissed. */
  dismiss: () => void;
  /** Mutate the visible toast in place — message, variant, icon,
   *  and duration are all live. The auto-dismiss timer resets to
   *  the (new or existing) `duration`; pass `duration: 0` to make
   *  the toast sticky from this point on. */
  update: (message: string, options?: ToastOptions) => void;
};

export interface ToastFn {
  (message: string, options?: ToastOptions): ToastHandle;
  success: (message: string, options?: Omit<ToastOptions, "variant">) => ToastHandle;
  error: (message: string, options?: Omit<ToastOptions, "variant">) => ToastHandle;
  /** Dismiss every currently visible toast. Useful for route changes /
   *  major UI transitions where stale notifications are confusing. */
  dismissAll: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_DURATION_MS = 3000;
const MAX_VISIBLE_TOASTS = 5;
const ANIMATION_MS = 200;
const CONTAINER_ID = "ui-toast-container";

/** Variant → palette + default icon. Tailwind classes only — no
 *  bespoke CSS to avoid drift with the rest of the app. */
const VARIANT_STYLES: Record<ToastVariant, { container: string; iconClass: string }> = {
  default: {
    container:
      "bg-blue-50 dark:bg-blue-950/40 " +
      "border border-blue-200 dark:border-blue-800 " +
      "text-blue-900 dark:text-blue-200",
    iconClass: "ti-info-circle",
  },
  success: {
    container:
      "bg-green-50 dark:bg-green-950/40 " +
      "border border-green-200 dark:border-green-800 " +
      "text-green-900 dark:text-green-200",
    iconClass: "ti-check",
  },
  error: {
    container:
      "bg-red-50 dark:bg-red-950/40 " +
      "border border-red-200 dark:border-red-800 " +
      "text-red-900 dark:text-red-200",
    iconClass: "ti-alert-circle",
  },
};

// All currently-mounted toasts. Used for `dismissAll`.
const liveToasts = new Set<ToastHandle>();

// =============================================================================
// Container
// =============================================================================

/** Lazily-mount the fixed-position container. Idempotent. */
const ensureContainer = (): HTMLElement | null => {
  if (typeof document === "undefined") return null;
  let container = document.getElementById(CONTAINER_ID);
  if (container) return container;
  container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.className =
    "fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end max-w-sm " +
    // The gaps between toasts shouldn't intercept clicks on the page
    // beneath. Each toast re-enables pointer-events on itself.
    "pointer-events-none";
  document.body.appendChild(container);
  return container;
};

// =============================================================================
// Internals — element construction + style swap
// =============================================================================

/** Apply variant + iconClass to a toast element. Used both at create
 *  time and on `update()` to swap palette mid-life. */
const applyStyle = (
  toastEl: HTMLElement,
  iconEl: HTMLElement,
  variant: ToastVariant,
  iconClassOverride?: string,
) => {
  const style = VARIANT_STYLES[variant];
  // Strip any prior variant classes so update() doesn't accumulate
  // stacked palettes. We track them by re-resolving from the
  // VARIANT_STYLES values rather than carrying state on the element.
  for (const v of Object.values(VARIANT_STYLES)) {
    for (const cls of v.container.split(/\s+/)) {
      if (cls) toastEl.classList.remove(cls);
    }
  }
  for (const cls of style.container.split(/\s+/)) {
    if (cls) toastEl.classList.add(cls);
  }
  // Icon: remove every `ti-*` modifier class, keep the `ti` family
  // class so the font is still applied.
  for (const cls of Array.from(iconEl.classList)) {
    if (cls.startsWith("ti-")) iconEl.classList.remove(cls);
  }
  iconEl.classList.add(iconClassOverride ?? style.iconClass);
};

// =============================================================================
// Public API
// =============================================================================

const showToast = (message: string, options?: ToastOptions): ToastHandle => {
  const container = ensureContainer();
  // SSR / no-DOM environment — return a noop handle so callers can
  // ignore platform availability.
  if (!container) {
    const noop = () => {};
    return { dismiss: noop, update: noop };
  }

  let dismissed = false;
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;

  const toastEl = document.createElement("div");
  toastEl.className =
    "pointer-events-auto cursor-pointer flex items-start gap-2 " +
    "px-3 py-2 rounded-md text-sm shadow-lg " +
    "transition-all duration-200 ease-out " +
    // Initial off-screen state — we flip it on the next frame so
    // the browser renders the entry frame and animates the change.
    "translate-x-2 opacity-0";

  const iconEl = document.createElement("i");
  iconEl.className = "ti text-base shrink-0 mt-0.5";

  const messageEl = document.createElement("span");
  messageEl.className = "flex-1";
  messageEl.textContent = message;

  toastEl.appendChild(iconEl);
  toastEl.appendChild(messageEl);

  const initialVariant = options?.variant ?? "default";
  applyStyle(toastEl, iconEl, initialVariant, options?.iconClass);

  // ----- timer + dismiss -----

  const clearDismissTimer = () => {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  };

  const armDismissTimer = (duration: number) => {
    clearDismissTimer();
    if (duration > 0) {
      dismissTimer = setTimeout(() => dismiss(), duration);
    }
    // duration === 0 → sticky; rely on manual dismiss / dismissAll.
  };

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearDismissTimer();
    liveToasts.delete(handle);
    toastEl.classList.remove("translate-x-0", "opacity-100");
    toastEl.classList.add("translate-x-2", "opacity-0");
    setTimeout(() => toastEl.remove(), ANIMATION_MS);
  };

  const update = (nextMessage: string, nextOptions?: ToastOptions) => {
    if (dismissed) return;
    messageEl.textContent = nextMessage;
    if (nextOptions?.variant !== undefined || nextOptions?.iconClass !== undefined) {
      applyStyle(
        toastEl,
        iconEl,
        nextOptions.variant ?? initialVariant,
        nextOptions.iconClass,
      );
    }
    // Re-arm the dismiss timer using the new (or existing) duration.
    // Without this, an `update` to a near-expired toast would still
    // disappear ~immediately even if the user wanted fresh feedback.
    armDismissTimer(nextOptions?.duration ?? DEFAULT_DURATION_MS);
  };

  toastEl.addEventListener("click", dismiss);

  const handle: ToastHandle = { dismiss, update };
  liveToasts.add(handle);

  // ----- mount + animate in -----

  // Cap the visible stack BEFORE we add the new toast so the
  // overflow-removal doesn't visually flicker the new arrival.
  while (container.children.length >= MAX_VISIBLE_TOASTS) {
    container.firstElementChild?.remove();
  }
  container.appendChild(toastEl);

  requestAnimationFrame(() => {
    toastEl.classList.remove("translate-x-2", "opacity-0");
    toastEl.classList.add("translate-x-0", "opacity-100");
  });

  armDismissTimer(options?.duration ?? DEFAULT_DURATION_MS);

  return handle;
};

const toastFn = ((message: string, options?: ToastOptions) => showToast(message, options)) as ToastFn;

toastFn.success = (message, options) => showToast(message, { ...options, variant: "success" });
toastFn.error = (message, options) => showToast(message, { ...options, variant: "error" });
toastFn.dismissAll = () => {
  // Snapshot — `dismiss()` mutates `liveToasts`.
  for (const handle of Array.from(liveToasts)) handle.dismiss();
};

export const toast: ToastFn = toastFn;
