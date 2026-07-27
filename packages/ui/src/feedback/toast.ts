import { getK2bPortalRoot } from "../internal/portal";

export type ToastVariant = "info" | "success" | "warning" | "danger";

export type ToastAction = {
  label: string;
  href: string;
};

export type ToastOptions = {
  variant?: ToastVariant;
  duration?: number;
  icon?: string;
  title?: string;
  action?: ToastAction | null;
  resolveScope?: () => HTMLElement | null | undefined;
};

export type ToastHandle = {
  dismiss: () => void;
  update: (description: string, options?: ToastOptions) => void;
};

export interface ToastFn {
  (description: string, options?: ToastOptions): ToastHandle;
  success: (description: string, options?: Omit<ToastOptions, "variant">) => ToastHandle;
  warning: (description: string, options?: Omit<ToastOptions, "variant">) => ToastHandle;
  error: (description: string, options?: Omit<ToastOptions, "variant">) => ToastHandle;
  dismissAll: () => void;
}

const DEFAULT_DURATION = 3500;
const MAX_VISIBLE = 5;
const REMOVE_DELAY = 160;
const containers = new Map<HTMLElement, HTMLElement>();
const liveToasts = new Set<ToastHandle>();

const variantMeta: Record<ToastVariant, { title: string; icon: string }> = {
  info: { title: "Info", icon: "ti ti-info-circle" },
  success: { title: "Success", icon: "ti ti-check" },
  warning: { title: "Warning", icon: "ti ti-alert-triangle" },
  danger: { title: "Error", icon: "ti ti-alert-circle" },
};

const createContainer = (root: HTMLElement): HTMLElement => {
  const container = document.createElement("div");
  container.className = "k2b-toast-container";
  container.setAttribute("popover", "manual");
  root.appendChild(container);
  containers.set(root, container);
  return container;
};

const ensureContainer = (scope?: HTMLElement | null): { root: HTMLElement; container: HTMLElement } => {
  const root = getK2bPortalRoot(scope);
  const existing = containers.get(root);
  return {
    root,
    container: existing?.isConnected ? existing : createContainer(root),
  };
};

const promoteContainer = (root: HTMLElement, container: HTMLElement): HTMLElement => {
  if (typeof container.showPopover !== "function") return container;
  let active = container;
  try {
    if (container.matches(":popover-open") && document.querySelector("dialog:modal")) {
      const replacement = container.cloneNode(false) as HTMLElement;
      while (container.firstChild) replacement.appendChild(container.firstChild);
      container.remove();
      root.appendChild(replacement);
      containers.set(root, replacement);
      active = replacement;
    }
    if (!active.matches(":popover-open")) active.showPopover();
  } catch {
    active.removeAttribute("popover");
  }
  return active;
};

const hideEmptyContainer = (root: HTMLElement) => {
  const container = containers.get(root);
  if (!container || container.childElementCount > 0) return;
  try {
    if (container.matches(":popover-open")) container.hidePopover();
  } catch {
    // The container may already be detached.
  }
};

const showToast = (description: string, options: ToastOptions = {}): ToastHandle => {
  if (typeof document === "undefined") {
    const noop = () => {};
    return { dismiss: noop, update: noop };
  }

  const { root, container: initialContainer } = ensureContainer(options.resolveScope?.());
  const container = promoteContainer(root, initialContainer);
  let variant = options.variant ?? "info";
  let duration = options.duration ?? DEFAULT_DURATION;
  let remaining = duration;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dismissed = false;
  let pointerPaused = false;
  let focusPaused = false;

  const card = document.createElement("section");
  card.className = "k2b-toast";
  card.dataset.tone = variant;
  card.dataset.k2bTone = "";
  card.dataset.k2bToast = "";

  const icon = document.createElement("span");
  icon.className = "k2b-toast__icon";
  icon.setAttribute("aria-hidden", "true");
  const iconGlyph = document.createElement("i");
  icon.appendChild(iconGlyph);

  const content = document.createElement("div");
  content.className = "k2b-toast__content";
  content.setAttribute("role", variant === "danger" ? "alert" : "status");
  content.setAttribute("aria-live", variant === "danger" ? "assertive" : "polite");
  content.setAttribute("aria-atomic", "true");
  const title = document.createElement("strong");
  const body = document.createElement("span");
  content.append(title, body);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "k2b-toast__close";
  close.setAttribute("aria-label", "Dismiss notification");
  const closeIcon = document.createElement("i");
  closeIcon.className = "ti ti-x";
  closeIcon.setAttribute("aria-hidden", "true");
  close.appendChild(closeIcon);
  card.append(icon, content, close);

  let action: HTMLAnchorElement | undefined;
  const renderAction = (value: ToastAction | null | undefined) => {
    action?.remove();
    action = undefined;
    if (!value) return;
    action = document.createElement("a");
    action.className = "k2b-toast__action";
    action.href = value.href;
    action.textContent = value.label;
    content.appendChild(action);
  };

  const render = (nextDescription: string, nextOptions: ToastOptions, resetTitle: boolean) => {
    variant = nextOptions.variant ?? variant;
    card.dataset.tone = variant;
    content.setAttribute("role", variant === "danger" ? "alert" : "status");
    content.setAttribute("aria-live", variant === "danger" ? "assertive" : "polite");
    iconGlyph.className = nextOptions.icon ?? variantMeta[variant].icon;
    body.textContent = nextDescription;
    if (resetTitle || Object.hasOwn(nextOptions, "title")) {
      title.textContent = nextOptions.title ?? variantMeta[variant].title;
    }
    if (Object.hasOwn(nextOptions, "action")) renderAction(nextOptions.action);
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const pauseTimer = () => {
    if (!timer) return;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
    clearTimer();
  };
  const resumeTimer = () => {
    if (dismissed || duration === 0 || remaining <= 0 || pointerPaused || focusPaused) return;
    startedAt = Date.now();
    timer = setTimeout(() => handle.dismiss(), remaining);
  };
  const resetTimer = () => {
    clearTimer();
    remaining = duration;
    resumeTimer();
  };

  const handle: ToastHandle = {
    dismiss: () => {
      if (dismissed) return;
      dismissed = true;
      clearTimer();
      liveToasts.delete(handle);
      card.dataset.closing = "true";
      setTimeout(() => {
        card.remove();
        hideEmptyContainer(root);
      }, REMOVE_DELAY);
    },
    update: (nextDescription, nextOptions = {}) => {
      if (dismissed) return;
      const variantChanged = nextOptions.variant !== undefined && nextOptions.variant !== variant;
      if (Object.hasOwn(nextOptions, "duration")) duration = nextOptions.duration ?? DEFAULT_DURATION;
      render(nextDescription, nextOptions, variantChanged);
      resetTimer();
    },
  };

  close.addEventListener("click", handle.dismiss);
  card.addEventListener("pointerenter", () => {
    pointerPaused = true;
    pauseTimer();
  });
  card.addEventListener("pointerleave", () => {
    pointerPaused = false;
    resumeTimer();
  });
  card.addEventListener("focusin", () => {
    focusPaused = true;
    pauseTimer();
  });
  card.addEventListener("focusout", (event) => {
    if (card.contains(event.relatedTarget as Node | null)) return;
    focusPaused = false;
    resumeTimer();
  });

  render(description, options, true);
  liveToasts.add(handle);
  if (liveToasts.size > MAX_VISIBLE) liveToasts.values().next().value?.dismiss();
  container.appendChild(card);
  requestAnimationFrame(() => {
    card.dataset.open = "true";
  });
  resetTimer();
  return handle;
};

const toastFn = ((description: string, options?: ToastOptions) => showToast(description, options)) as ToastFn;
toastFn.success = (description, options) => showToast(description, { ...options, variant: "success" });
toastFn.warning = (description, options) => showToast(description, { ...options, variant: "warning" });
toastFn.error = (description, options) => showToast(description, { ...options, variant: "danger" });
toastFn.dismissAll = () => {
  for (const handle of [...liveToasts]) handle.dismiss();
};

export const isPointInsideToast = (x: number, y: number): boolean => {
  if (typeof document === "undefined") return false;
  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-k2b-toast]"))) {
    const rect = element.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
  }
  return false;
};

export const toast: ToastFn = toastFn;
