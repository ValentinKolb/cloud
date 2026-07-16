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
 * White card body on a soft float, neutral zinc title, dimmed gray
 * description. The variant signal lives in a leading soft-tinted disc
 * with a colour-matched icon (the elevated, low-shout treatment from
 * the redesign — a faint wash rather than a loud saturated fill):
 *   - `default` → soft blue disc with info icon
 *   - `success` → soft green disc with check icon
 *   - `error`   → soft red disc with X icon
 *
 * Dark mode mirrors with `zinc-900` body, lighter zinc text; the disc
 * tint + icon colour shift to the lighter 400-tones so the variant
 * still reads at a glance against the dark surface.
 *
 * Stacking
 * --------
 * The container is a `popover="manual"` element shown via
 * `showPopover()`, which places it in the browser top layer. That is
 * the only way to render above dialogCore modals — `showModal()` also
 * uses the top layer, which out-stacks ANY z-index, so a plain
 * `z-50` container is invisible while a modal is open. Every new
 * toast re-shows the popover, moving it after any dialog opened in
 * the meantime, so toasts stay on top regardless of open order.
 * Manual popovers have no light dismiss and never steal focus, so
 * toasts remain fire-and-forget and don't interfere with the modal's
 * focus trap.
 *
 * One caveat: while a modal is open the browser marks everything
 * outside it inert — including this popover, even though it PAINTS
 * above the modal. Toasts above a modal are therefore read-only:
 * auto-dismiss timers still run, but click-to-dismiss doesn't (the
 * click retargets to the dialog backdrop). `isPointInsideToast` lets
 * dialogCore ignore those retargeted clicks so aiming at a toast
 * doesn't accidentally close the modal.
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
 * toast.success("Item moved", {
 *   action: { label: "Open destination", href: "/app/spaces/target?item=123" },
 * });
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

export type ToastAction = {
  /** Short link label rendered below the description. */
  label: string;
  /** Navigation target. Native anchor semantics keep the action robust across apps. */
  href: string;
};

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
  /** Optional navigation link. Pass `null` to remove an existing action during `update()`. */
  action?: ToastAction | null;
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

/** Per-variant rendering recipe. The lead element is a 36 px soft-tinted
 *  disc with a colour-matched icon — a faint wash (`/10`–`/15` alpha)
 *  rather than a saturated fill, so it reads as elevated rather than
 *  shouty. Tint + icon colour shift to the 400-tones in dark mode so
 *  the variant signal survives the theme flip. */
type VariantStyle = {
  /** Tailwind classes for the disc's soft-tinted background (light + dark). */
  circleBgClass: string;
  /** Tailwind classes for the icon colour inside the disc (light + dark). */
  iconColorClass: string;
  /** Default `ti-…` class for the disc's icon. Overridable via
   *  `options.iconClass`. */
  iconClass: string;
  /** Default title shown when `options.title` is not set. */
  defaultTitle: string;
};

const VARIANT_STYLES: Record<ToastVariant, VariantStyle> = {
  default: {
    circleBgClass: "bg-blue-500/10 dark:bg-blue-400/15",
    iconColorClass: "text-blue-600 dark:text-blue-400",
    iconClass: "ti-info-circle",
    defaultTitle: "Info",
  },
  success: {
    circleBgClass: "bg-green-500/15 dark:bg-green-400/15",
    iconColorClass: "text-green-600 dark:text-green-400",
    iconClass: "ti-check",
    defaultTitle: "Success",
  },
  error: {
    circleBgClass: "bg-red-500/15 dark:bg-red-400/15",
    iconColorClass: "text-red-600 dark:text-red-400",
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

/** Lazily-mount the fixed-position container. Idempotent.
 *
 *  The container carries `popover="manual"` so it can be promoted to
 *  the browser top layer (see the "Stacking" note above). In browsers
 *  without the Popover API the attribute is inert and the container
 *  behaves like the plain `fixed z-50` element it always was. */
const ensureContainer = (): HTMLElement | null => {
  if (typeof document === "undefined") return null;
  let container = document.getElementById(CONTAINER_ID);
  if (container) return container;
  container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.setAttribute("popover", "manual");
  // Positioning lives in INLINE styles, not utility classes: the rail must
  // undo the UA popover styles (`inset:0` + `margin:auto` centring, Canvas
  // background, border, padding) even when a page's stylesheet build never
  // scanned this file — a mispositioned toast rail is a platform-wide bug.
  // Inline styles survive cloneNode() in promoteToTopLayer unchanged.
  container.style.cssText =
    "position:fixed;top:auto;left:auto;bottom:1rem;right:1rem;z-index:50;" +
    "display:flex;flex-direction:column;gap:0.5rem;width:auto;height:auto;max-width:none;max-height:none;" +
    "margin:0;padding:0;border:0;background:transparent;overflow:visible;" +
    // The gaps between toasts shouldn't intercept clicks on the page
    // beneath. Each toast re-enables pointer-events on itself.
    "pointer-events:none;";
  document.body.appendChild(container);
  return container;
};

/** (Re-)promote the container to the end of the browser top layer.
 *
 *  Called for every new toast, so the toast rail lands above any
 *  modal `<dialog>` opened since the last call, regardless of open
 *  order.
 *
 *  Re-showing (`hidePopover()`+`showPopover()`) or even re-appending
 *  the SAME element does not reliably move it past a modal dialog:
 *  top-layer removals are deferred to the rendering update, and a
 *  same-frame re-show can leave the element at its OLD top-layer
 *  position (observed in Chromium — the rail stayed under a modal
 *  opened after it). So whenever the container might already hold a
 *  stale top-layer position (it's popover-open, or a modal is up), it
 *  is swapped for a fresh shallow clone: toasts move over with their
 *  listeners intact, and the brand-new element gets a brand-new
 *  top-layer entry at the END — deterministically, in the same task,
 *  no paint in between (so no flicker).
 *
 *  If `showPopover()` unexpectedly throws, drop the `popover`
 *  attribute entirely: a closed popover is `display:none !important`
 *  per UA stylesheet, and a permanently-hidden toast rail is far worse
 *  than one that merely stacks under modals. */
const promoteToTopLayer = (container: HTMLElement): void => {
  if (typeof container.showPopover !== "function" || !container.isConnected) return;
  let active = container;
  try {
    if (container.matches(":popover-open") || document.querySelector("dialog:modal")) {
      const next = container.cloneNode(false) as HTMLElement;
      while (container.firstChild) next.appendChild(container.firstChild);
      container.remove();
      document.body.appendChild(next);
      active = next;
    }
    if (!active.matches(":popover-open")) active.showPopover();
  } catch {
    active.removeAttribute("popover");
  }
};

/** Close the popover once the last toast is gone so an empty container
 *  doesn't linger in the top layer. Resolves the container by ID at
 *  call time — `promoteToTopLayer` may have swapped the element since
 *  the caller captured it. No-op while toasts remain or when the
 *  Popover API is unavailable. */
const hideContainerIfEmpty = (): void => {
  if (typeof document === "undefined") return;
  const container = document.getElementById(CONTAINER_ID);
  if (!container || container.childElementCount > 0) return;
  if (typeof container.hidePopover !== "function") return;
  try {
    if (container.matches(":popover-open")) container.hidePopover();
  } catch {
    // Already hidden or disconnected — nothing to do.
  }
};

// =============================================================================
// Internals — element construction + style swap
// =============================================================================

/** Strip every variant's disc-tint classes from an element. Used in
 *  the variant swap path so repeated `update()` calls don't
 *  accumulate stacked palettes. */
const stripAllLeadBg = (el: HTMLElement): void => {
  for (const v of Object.values(VARIANT_STYLES)) {
    for (const cls of splitClasses(v.circleBgClass)) el.classList.remove(cls);
  }
};

/** Reset an element's classes to a fresh class list. Used so swap
 *  logic doesn't have to track what was there before. */
const setClasses = (el: HTMLElement, cls: string): void => {
  el.className = cls;
};

/** Build / rebuild the lead element (the leftmost variant signal): a
 *  36 px soft-tinted disc containing a colour-matched `<i>` icon. On
 *  variant swap we replace the disc's children + classes wholesale
 *  rather than morph in place.
 *
 *  Returns the icon element so the caller can override the icon-class
 *  later via `update({ iconClass: ... })`. */
const renderLead = (leadEl: HTMLElement, variant: ToastVariant, iconClassOverride?: string): HTMLElement => {
  const style = VARIANT_STYLES[variant];
  leadEl.replaceChildren();
  setClasses(leadEl, "shrink-0 self-start w-9 h-9 rounded-full flex items-center justify-center");
  for (const cls of splitClasses(style.circleBgClass)) leadEl.classList.add(cls);
  const iconEl = document.createElement("i");
  iconEl.className = `ti ${iconClassOverride ?? style.iconClass} ${style.iconColorClass} text-base`;
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
    "p-3 rounded-md [box-shadow:var(--theme-shadow-float)] " +
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
    setTimeout(() => {
      toastEl.remove();
      hideContainerIfEmpty();
    }, ANIMATION_MS);
  };

  let actionEl: HTMLAnchorElement | null = null;
  const renderAction = (action: ToastAction | null | undefined) => {
    actionEl?.remove();
    actionEl = null;
    if (!action) return;

    actionEl = document.createElement("a");
    actionEl.className = "focus-ui mt-1 self-start text-xs font-medium text-blue-600 hover:underline dark:text-blue-400";
    actionEl.href = action.href;
    actionEl.textContent = action.label;
    actionEl.addEventListener("click", (event) => {
      event.stopPropagation();
      dismiss();
    });
    contentEl.appendChild(actionEl);
  };

  renderAction(options?.action);

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

    if (nextOptions && Object.prototype.hasOwnProperty.call(nextOptions, "action")) {
      renderAction(nextOptions.action);
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
  promoteToTopLayer(container);

  requestAnimationFrame(() => {
    toastEl.classList.remove("translate-x-2", "opacity-0");
    toastEl.classList.add("translate-x-0", "opacity-100");
  });

  armDismissTimer(options?.duration ?? DEFAULT_DURATION_MS);

  return handle;
};

/** True when the given viewport point lies inside a currently-visible
 *  toast. Consumed by dialogCore's backdrop-click detection: while a
 *  modal is open the toast rail above it is inert (modal blocking), so
 *  a click aimed at a toast retargets to the dialog backdrop — without
 *  this check that click would close the modal. */
export const isPointInsideToast = (x: number, y: number): boolean => {
  if (typeof document === "undefined") return false;
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return false;
  for (const child of Array.from(container.children)) {
    const r = child.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
};

const toastFn = ((description: string, options?: ToastOptions) => showToast(description, options)) as ToastFn;

toastFn.success = (description, options) => showToast(description, { ...options, variant: "success" });
toastFn.error = (description, options) => showToast(description, { ...options, variant: "error" });
toastFn.dismissAll = () => {
  // Snapshot — `dismiss()` mutates `liveToasts`.
  for (const handle of Array.from(liveToasts)) handle.dismiss();
};

export const toast: ToastFn = toastFn;
