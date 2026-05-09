/**
 * Toast — transient bottom-right notifications, Mantine-style.
 *
 * Sits next to `prompts` as the platform's lightweight messaging
 * surface: where `prompts.alert/confirm/form` are blocking modals,
 * `toast()` is fire-and-forget feedback that the user doesn't have
 * to dismiss.
 *
 * API shape
 * ---------
 * The first positional arg is the **description** (the body line);
 * the title defaults to the variant name ("Info" / "Success" /
 * "Error") and can be overridden via `options.title`. Rationale:
 * for the 95 % case ("just tell the user something happened") the
 * default title is fine, and the desc is what carries the actual
 * information. Spelling out a custom title is opt-in.
 *
 * Visual language
 * ---------------
 * White card body, neutral zinc title, dimmed gray description. The
 * variant signal lives in a small leading element:
 *   - `default` → 3 px wide blue vertical bar (no icon)
 *   - `success` → solid green circle with white check icon
 *   - `error`   → solid red circle with white X icon
 *
 * Dark mode mirrors with `zinc-900` body, lighter zinc text;
 * circle / bar colors stay saturated so the variant signal reads
 * at a glance regardless of theme.
 *
 * Every toast in the stack renders at the same fixed width
 * (`TOAST_WIDTH_CLASS`) so they line up neatly when stacked.
 *
 * Usage
 * -----
 * ```ts
 * import { toast } from "@valentinkolb/cloud/ui";
 *
 * toast("All changes synced");                           // title "Info"
 * toast("All changes synced", { title: "Saved" });
 * toast.success("Untitled-3 created");                   // title "Success"
 * toast.error("Network unreachable");                    // title "Error"
 * toast.error("Network unreachable", { title: "Bummer!", duration: 5000 });
 *
 * const t = toast("0%", { title: "Uploading", duration: 0 });
 * t.update("50%");
 * t.update("Everything fine", { variant: "success", title: "Done", duration: 2000 });
 *
 * toast.dismissAll();
 * ```
 *
 * SSR-safe: every entry point bails when `document` is unavailable.
 */

export type ToastVariant = "default" | "success" | "error";

export type ToastOptions = {
  /** Visual style. Default `"default"` (blue left-bar). */
  variant?: ToastVariant;
  /** Auto-dismiss after this many ms. Default `3000`. `0` = sticky
   *  (only manual `t.dismiss()` removes it). */
  duration?: number;
  /** `ti-…` icon class to override the variant default. Only
   *  applies to `success` / `error` variants — the `default`
   *  variant doesn't render an icon. */
  iconClass?: string;
  /** Override the variant default title (`"Info"` / `"Success"` /
   *  `"Error"`). Pass any string — `""` renders an empty title row. */
  title?: string;
};

export type ToastHandle = {
  /** Animate out and remove. No-op if already dismissed. */
  dismiss: () => void;
  /**
   * Mutate the visible toast in place. Only present option keys
   * change; missing keys leave the existing values alone.
   *  - `update("X")` → desc becomes "X", everything else unchanged
   *  - `update("X", { title: "Saved" })` → desc + title both update
   *  - `update("X", { variant: "success" })` → swaps the leading
   *    element (bar ↔ circle) AND swaps the title to the new
   *    variant default unless `title` is explicitly passed
   *
   * The auto-dismiss timer resets to the (new or existing)
   * `duration` so a near-expired toast doesn't disappear right
   * after a fresh update.
   */
  update: (description: string, options?: ToastOptions) => void;
};

export interface ToastFn {
  (description: string, options?: ToastOptions): ToastHandle;
  success: (description: string, options?: Omit<ToastOptions, "variant">) => ToastHandle;
  error: (description: string, options?: Omit<ToastOptions, "variant">) => ToastHandle;
  /** Dismiss every currently visible toast. Useful for route
   *  changes / major UI transitions where stale notifications are
   *  confusing. */
  dismissAll: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_DURATION_MS = 3000;
const MAX_VISIBLE_TOASTS = 5;
const ANIMATION_MS = 200;
const CONTAINER_ID = "ui-toast-container";

/** Fixed width for every toast — all toasts in the stack line up at
 *  this exact width regardless of content length. `w-80` = 20 rem ≈
 *  320 px; intentionally narrower than Mantine's default so toasts
 *  don't dominate the right rail. To make this configurable later,
 *  lift to an option. */
const TOAST_WIDTH_CLASS = "w-80";

/** Per-variant rendering recipe. The lead element is a thin colored
 *  bar for `default` (no icon — quiet visual treatment) and a solid
 *  colored circle with a white icon for `success` / `error` (loud
 *  affordance). Saturation stays high in both light + dark so the
 *  variant signal doesn't get washed out by theme. */
type VariantStyle = {
  /** `lead` element kind. `bar` is a 3 px vertical pill that
   *  stretches to the toast's full height; `circle` is a 36 px
   *  filled disc with a white icon inside. */
  lead: "bar" | "circle";
  /** Tailwind classes for the lead element's background. */
  leadBgClass: string;
  /** Default `ti-…` class for the circle's icon (ignored when
   *  `lead === "bar"`). Overridable via `options.iconClass`. */
  iconClass: string;
  /** Default title shown when `options.title` is not set. */
  defaultTitle: string;
};

const VARIANT_STYLES: Record<ToastVariant, VariantStyle> = {
  default: {
    lead: "bar",
    leadBgClass: "bg-blue-500 dark:bg-blue-400",
    iconClass: "ti-info-circle",
    defaultTitle: "Info",
  },
  success: {
    lead: "circle",
    leadBgClass: "bg-green-500 dark:bg-green-500",
    iconClass: "ti-check",
    defaultTitle: "Success",
  },
  error: {
    lead: "circle",
    leadBgClass: "bg-red-500 dark:bg-red-500",
    iconClass: "ti-x",
    defaultTitle: "Error",
  },
};

const splitClasses = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);

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
    // Container sits flush bottom-right with a small offset; toasts
    // stack vertically with `gap-2`. No max-width or items-end — the
    // toasts have their own fixed width and naturally align right
    // because the container itself is right-anchored.
    "fixed bottom-4 right-4 z-50 flex flex-col gap-2 " +
    // The gaps between toasts shouldn't intercept clicks on the page
    // beneath. Each toast re-enables pointer-events on itself.
    "pointer-events-none";
  document.body.appendChild(container);
  return container;
};

// =============================================================================
// Internals — element construction + style swap
// =============================================================================

/** Strip every variant's lead-bg classes from an element. Used in
 *  the variant swap path so repeated `update()` calls don't
 *  accumulate stacked palettes. */
const stripAllLeadBg = (el: HTMLElement): void => {
  for (const v of Object.values(VARIANT_STYLES)) {
    for (const cls of splitClasses(v.leadBgClass)) el.classList.remove(cls);
  }
};

/** Reset an element's classes to a fresh class list. Used so swap
 *  logic doesn't have to track what was there before. */
const setClasses = (el: HTMLElement, cls: string): void => {
  el.className = cls;
};

/** Build / rebuild the lead element (the leftmost variant signal).
 *  For `bar`: a self-stretching vertical pill. For `circle`: a
 *  filled disc containing a white `<i>` icon. The DOM shape differs
 *  between the two; on variant swap we replace the lead's children
 *  + classes wholesale rather than try to morph in place.
 *
 *  Returns the icon element (or null for `bar`) so the caller can
 *  override the icon-class later via `update({ iconClass: ... })`. */
const renderLead = (
  leadEl: HTMLElement,
  variant: ToastVariant,
  iconClassOverride?: string,
): HTMLElement | null => {
  const style = VARIANT_STYLES[variant];
  leadEl.replaceChildren();
  if (style.lead === "bar") {
    // `self-stretch` makes the bar match the toast's full height.
    setClasses(leadEl, "self-stretch w-1 rounded-full shrink-0");
    for (const cls of splitClasses(style.leadBgClass)) leadEl.classList.add(cls);
    return null;
  }
  // Circle variant — solid filled disc, white icon centered.
  setClasses(
    leadEl,
    "shrink-0 self-start w-9 h-9 rounded-full flex items-center justify-center",
  );
  for (const cls of splitClasses(style.leadBgClass)) leadEl.classList.add(cls);
  const iconEl = document.createElement("i");
  iconEl.className = `ti ${iconClassOverride ?? style.iconClass} text-white text-base`;
  leadEl.appendChild(iconEl);
  return iconEl;
};

// =============================================================================
// Public API
// =============================================================================

const showToast = (description: string, options?: ToastOptions): ToastHandle => {
  const container = ensureContainer();
  if (!container) {
    const noop = () => {};
    return { dismiss: noop, update: noop };
  }

  let dismissed = false;
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  let currentVariant: ToastVariant = options?.variant ?? "default";

  // ----- DOM scaffolding -----

  // Toast card. White / zinc-900 body, neutral text, soft shadow,
  // no border (the lead element is the only color affordance).
  // Fixed width so every toast in the stack lines up. Click-anywhere
  // dismisses — there's no explicit close button.
  const toastEl = document.createElement("div");
  toastEl.className =
    `pointer-events-auto cursor-pointer flex items-stretch gap-3 ${TOAST_WIDTH_CLASS} ` +
    "p-3 rounded-md shadow-md " +
    "bg-white dark:bg-zinc-900 " +
    "transition-all duration-200 ease-out " +
    // Initial off-screen state — flipped on the next frame so the
    // browser renders the entry frame and animates the change.
    "translate-x-2 opacity-0";

  const leadEl = document.createElement("div");
  let leadIconEl = renderLead(leadEl, currentVariant, options?.iconClass);

  // Content column — title + description.
  const contentEl = document.createElement("div");
  contentEl.className = "flex-1 min-w-0 self-center flex flex-col gap-0.5";

  // Title — variant default ("Info" / "Success" / "Error") unless
  // overridden via `options.title`. Subtle weight + tone — toasts
  // are peripheral feedback and loud body text reads as alert.
  const titleEl = document.createElement("div");
  titleEl.className = "text-sm font-medium text-zinc-800 dark:text-zinc-200 leading-tight";
  titleEl.textContent = options?.title ?? VARIANT_STYLES[currentVariant].defaultTitle;

  // Description (the positional first arg).
  const descEl = document.createElement("div");
  descEl.className = "text-xs text-zinc-500 dark:text-zinc-400 leading-snug";
  descEl.textContent = description;

  contentEl.appendChild(titleEl);
  contentEl.appendChild(descEl);

  toastEl.appendChild(leadEl);
  toastEl.appendChild(contentEl);

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

  const update = (nextDescription: string, nextOptions?: ToastOptions) => {
    if (dismissed) return;

    // Description is positional and always replaces.
    descEl.textContent = nextDescription;

    // Variant swap: re-render the lead element wholesale (bar↔circle
    // is a DOM-shape change). Strip stale bg classes first so we
    // don't blend the previous variant's tint into the new one.
    const variantChanged = nextOptions?.variant !== undefined && nextOptions.variant !== currentVariant;
    if (variantChanged) {
      currentVariant = nextOptions.variant!;
      stripAllLeadBg(leadEl);
      leadIconEl = renderLead(leadEl, currentVariant, nextOptions.iconClass);
    } else if (nextOptions?.iconClass !== undefined && leadIconEl) {
      // Same variant, new iconClass — just swap the modifier on the
      // existing icon node. Only meaningful for circle variants.
      for (const cls of Array.from(leadIconEl.classList)) {
        if (cls.startsWith("ti-")) leadIconEl.classList.remove(cls);
      }
      leadIconEl.classList.add(nextOptions.iconClass);
    }

    // Title:
    //  - explicit `options.title` always wins (incl. `""` for empty)
    //  - else if variant changed, follow the new variant's default
    //    so a `update("...", { variant: "success" })` flips both bar
    //    and title to "Success" without forcing the caller to spell
    //    out the title string
    //  - else leave the title as-is
    if (nextOptions && Object.prototype.hasOwnProperty.call(nextOptions, "title")) {
      titleEl.textContent = nextOptions.title ?? "";
    } else if (variantChanged) {
      titleEl.textContent = VARIANT_STYLES[currentVariant].defaultTitle;
    }

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

const toastFn = ((description: string, options?: ToastOptions) => showToast(description, options)) as ToastFn;

toastFn.success = (description, options) => showToast(description, { ...options, variant: "success" });
toastFn.error = (description, options) => showToast(description, { ...options, variant: "error" });
toastFn.dismissAll = () => {
  // Snapshot — `dismiss()` mutates `liveToasts`.
  for (const handle of Array.from(liveToasts)) handle.dismiss();
};

export const toast: ToastFn = toastFn;
