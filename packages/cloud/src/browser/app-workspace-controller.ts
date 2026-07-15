import {
  APP_WORKSPACE_SIDEBAR_COLLAPSED,
  APP_WORKSPACE_SIDEBAR_MIN,
  type AppWorkspaceLayoutState,
  appWorkspaceCookieName,
  appWorkspaceResizeLimits,
  readAppWorkspaceLayoutCookie,
  resolveAppWorkspaceSidebarWidth,
  serializeAppWorkspaceLayoutState,
} from "../ui/misc/app-workspace-state";

type ResizeKind = "sidebar" | "detail";

type ActiveResize = {
  handle: HTMLElement;
  root: HTMLElement;
  kind: ResizeKind;
  pointerId: number;
  startX: number;
  startWidth: number;
  previousUserSelect: string;
};

const HANDLE_SELECTOR = "[data-app-workspace-resize]";
const LABEL_SELECTOR = "[data-app-workspace-label]";

const clamp = (value: number, min: number, max: number): number => Math.round(Math.min(max, Math.max(min, value)));

const eventElement = (event: Event): Element | null => (event.target instanceof Element ? event.target : null);

const resizeHandle = (event: Event): HTMLElement | null => eventElement(event)?.closest<HTMLElement>(HANDLE_SELECTOR) ?? null;

const resizeKind = (handle: HTMLElement): ResizeKind | null => {
  const value = handle.dataset.appWorkspaceResize;
  return value === "sidebar" || value === "detail" ? value : null;
};

const workspaceRoot = (handle: HTMLElement): HTMLElement | null => handle.closest<HTMLElement>(".app-workspace");

const workspaceCanvas = (root: HTMLElement): HTMLElement => root.closest<HTMLElement>(".cloud-app-canvas") ?? root;

const sidebarCollapsible = (root: HTMLElement): boolean =>
  root.querySelector<HTMLElement>(":scope > .workspace-sidebar")?.dataset.workspaceCollapsible === "true";

const visibleWidth = (root: HTMLElement, selector: string): number => {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element || getComputedStyle(element).display === "none") return 0;
  return element.getBoundingClientRect().width;
};

const widthLimits = (root: HTMLElement, kind: ResizeKind): { min: number; max: number } => {
  return appWorkspaceResizeLimits({
    kind,
    workspaceWidth: root.getBoundingClientRect().width,
    sidebarWidth: visibleWidth(root, ".workspace-sidebar"),
    detailWidth: visibleWidth(root, ".workspace-detail"),
    sidebarCollapsible: kind === "sidebar" && sidebarCollapsible(root),
  });
};

const currentWidth = (root: HTMLElement, kind: ResizeKind): number =>
  visibleWidth(root, kind === "sidebar" ? ".workspace-sidebar" : ".workspace-detail");

const updateHandleValue = (root: HTMLElement, handle: HTMLElement, kind: ResizeKind, width: number) => {
  const { min, max } = widthLimits(root, kind);
  handle.setAttribute("aria-valuemin", String(min));
  handle.setAttribute("aria-valuemax", String(max));
  handle.setAttribute("aria-valuenow", String(clamp(width, min, max)));
};

const sidebarSnapTimers = new WeakMap<HTMLElement, number>();

const markSidebarSnap = (root: HTMLElement) => {
  const previous = sidebarSnapTimers.get(root);
  if (previous !== undefined) window.clearTimeout(previous);
  root.dataset.workspaceSidebarSnapping = "true";
  sidebarSnapTimers.set(
    root,
    window.setTimeout(() => {
      delete root.dataset.workspaceSidebarSnapping;
      sidebarSnapTimers.delete(root);
    }, 180),
  );
};

const applyWidth = (root: HTMLElement, handle: HTMLElement, kind: ResizeKind, requestedWidth: number): number => {
  const { min, max } = widthLimits(root, kind);
  const canvas = workspaceCanvas(root);
  const previousCollapsed = canvas.dataset.workspaceSidebarCollapsed === "true";
  const sidebar = kind === "sidebar" ? resolveAppWorkspaceSidebarWidth(requestedWidth, max, sidebarCollapsible(root)) : null;
  const width = sidebar?.width ?? clamp(requestedWidth, min, max);
  if (sidebar) {
    if (sidebar.collapsed) canvas.dataset.workspaceSidebarCollapsed = "true";
    else delete canvas.dataset.workspaceSidebarCollapsed;
    if (sidebar.collapsed !== previousCollapsed) markSidebarSnap(root);
  }
  canvas.style.setProperty(kind === "sidebar" ? "--workspace-sidebar-width" : "--workspace-detail-width", `${width}px`);
  updateHandleValue(root, handle, kind, width);
  return width;
};

const readClientState = (appId: string | null): AppWorkspaceLayoutState => {
  if (!appId) return { version: 1 };
  return readAppWorkspaceLayoutCookie(document.cookie, appId) ?? { version: 1 };
};

const writeClientState = (appId: string | null, state: AppWorkspaceLayoutState) => {
  if (!appId) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${appWorkspaceCookieName(appId)}=${serializeAppWorkspaceLayoutState(state)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
};

const measureLabel = (label: HTMLElement) => {
  const text = label.querySelector<HTMLElement>("[data-app-workspace-label-text]");
  if (!text) return;
  const overflow = Math.max(0, text.scrollWidth - label.clientWidth);
  label.style.setProperty("--sidebar-label-overflow", `${overflow}px`);
  if (overflow > 2) label.dataset.overflow = "true";
  else delete label.dataset.overflow;
};

export const installAppWorkspaceController = (options: { appId?: string | null } = {}): (() => void) => {
  const appId = options.appId ?? document.querySelector<HTMLElement>(".cloud-app-canvas")?.dataset.appId ?? null;
  let layoutState = readClientState(appId);
  let active: ActiveResize | null = null;

  const persistWidth = (kind: ResizeKind, width: number) => {
    const collapsed = kind === "sidebar" && width === APP_WORKSPACE_SIDEBAR_COLLAPSED;
    layoutState = {
      ...layoutState,
      version: 1,
      ...(kind === "sidebar"
        ? { sidebarWidth: collapsed ? layoutState.sidebarWidth : width, sidebarCollapsed: collapsed }
        : { detailWidth: width }),
    };
    writeClientState(appId, layoutState);
  };

  const stopResize = (event?: Event) => {
    if (!active || (event instanceof PointerEvent && event.pointerId !== active.pointerId)) return;
    const finished = active;
    active = null;
    const width = applyWidth(finished.root, finished.handle, finished.kind, currentWidth(finished.root, finished.kind));
    persistWidth(finished.kind, width);
    delete finished.root.dataset.workspaceResizeActive;
    document.body.style.userSelect = finished.previousUserSelect;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
    window.removeEventListener("blur", stopResize);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return;
    const delta = event.clientX - active.startX;
    const requested = active.kind === "sidebar" ? active.startWidth + delta : active.startWidth - delta;
    applyWidth(active.root, active.handle, active.kind, requested);
  };

  const onPointerDown = (event: PointerEvent) => {
    const handle = resizeHandle(event);
    const kind = handle ? resizeKind(handle) : null;
    const root = handle ? workspaceRoot(handle) : null;
    if (!handle || !kind || !root || event.button !== 0) return;

    event.preventDefault();
    stopResize();
    active = {
      handle,
      root,
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: currentWidth(root, kind),
      previousUserSelect: document.body.style.userSelect,
    };
    root.dataset.workspaceResizeActive = kind;
    document.body.style.userSelect = "none";
    handle.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    window.addEventListener("blur", stopResize);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const handle = resizeHandle(event);
    const kind = handle ? resizeKind(handle) : null;
    const root = handle ? workspaceRoot(handle) : null;
    if (!handle || !kind || !root) return;

    const current = currentWidth(root, kind);
    const { min, max } = widthLimits(root, kind);
    const step = event.shiftKey ? 32 : 8;
    let requested: number | null = null;
    if (event.key === "Home") requested = min;
    else if (event.key === "End") requested = max;
    else if (event.key === "ArrowLeft") {
      requested =
        kind === "sidebar" && sidebarCollapsible(root) && current <= APP_WORKSPACE_SIDEBAR_MIN
          ? APP_WORKSPACE_SIDEBAR_COLLAPSED
          : kind === "sidebar"
            ? current - step
            : current + step;
    } else if (event.key === "ArrowRight") {
      requested =
        kind === "sidebar" && sidebarCollapsible(root) && current <= APP_WORKSPACE_SIDEBAR_COLLAPSED
          ? (layoutState.sidebarWidth ?? APP_WORKSPACE_SIDEBAR_MIN)
          : kind === "sidebar"
            ? current + step
            : current - step;
    }
    if (requested === null) return;

    event.preventDefault();
    persistWidth(kind, applyWidth(root, handle, kind, requested));
  };

  const onPointerOver = (event: PointerEvent) => {
    const label = eventElement(event)?.closest<HTMLElement>(LABEL_SELECTOR);
    if (!label || (event.relatedTarget instanceof Node && label.contains(event.relatedTarget))) return;
    requestAnimationFrame(() => measureLabel(label));
  };

  const onFocusIn = (event: FocusEvent) => {
    const handle = resizeHandle(event);
    const kind = handle ? resizeKind(handle) : null;
    const root = handle ? workspaceRoot(handle) : null;
    if (handle && kind && root) updateHandleValue(root, handle, kind, currentWidth(root, kind));

    const label = eventElement(event)?.closest<HTMLElement>("[data-app-workspace-item]")?.querySelector<HTMLElement>(LABEL_SELECTOR);
    if (label) requestAnimationFrame(() => measureLabel(label));
  };

  const clearMeasuredLabels = () => {
    document.querySelectorAll<HTMLElement>(LABEL_SELECTOR).forEach((label) => {
      delete label.dataset.overflow;
      label.style.removeProperty("--sidebar-label-overflow");
    });
  };

  const primaryWorkspaceRoot = (): HTMLElement | null => {
    const roots = Array.from(document.querySelectorAll<HTMLElement>(".app-workspace")).filter(
      (root) => getComputedStyle(root).display !== "none" && root.getBoundingClientRect().width > 0,
    );
    return roots.reduce<HTMLElement | null>(
      (largest, root) => (!largest || root.getBoundingClientRect().width > largest.getBoundingClientRect().width ? root : largest),
      null,
    );
  };

  const directHandle = (root: HTMLElement, kind: ResizeKind): HTMLElement | null =>
    root.querySelector<HTMLElement>(`:scope > [data-app-workspace-resize="${kind}"]`);

  const reconcilePersistedWidths = () => {
    const root = primaryWorkspaceRoot();
    if (!root) return;
    if (layoutState.sidebarWidth !== undefined) {
      const handle = directHandle(root, "sidebar");
      if (handle) {
        applyWidth(
          root,
          handle,
          "sidebar",
          layoutState.sidebarCollapsed && sidebarCollapsible(root) ? APP_WORKSPACE_SIDEBAR_COLLAPSED : layoutState.sidebarWidth,
        );
      }
    } else if (layoutState.sidebarCollapsed && sidebarCollapsible(root)) {
      const handle = directHandle(root, "sidebar");
      if (handle) applyWidth(root, handle, "sidebar", APP_WORKSPACE_SIDEBAR_COLLAPSED);
    }
    if (layoutState.detailWidth !== undefined) {
      const handle = directHandle(root, "detail");
      if (handle) applyWidth(root, handle, "detail", layoutState.detailWidth);
    }
  };

  let resizeFrame: number | null = null;
  const onWindowResize = () => {
    clearMeasuredLabels();
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      reconcilePersistedWidths();
    });
  };

  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerover", onPointerOver);
  document.addEventListener("focusin", onFocusIn);
  window.addEventListener("resize", onWindowResize);
  const initialSyncFrame = requestAnimationFrame(() => {
    reconcilePersistedWidths();
    document.querySelectorAll<HTMLElement>(HANDLE_SELECTOR).forEach((handle) => {
      const kind = resizeKind(handle);
      const root = workspaceRoot(handle);
      if (kind && root) updateHandleValue(root, handle, kind, currentWidth(root, kind));
    });
  });

  return () => {
    cancelAnimationFrame(initialSyncFrame);
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    stopResize();
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointerover", onPointerOver);
    document.removeEventListener("focusin", onFocusIn);
    window.removeEventListener("resize", onWindowResize);
  };
};
