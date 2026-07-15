import {
  APP_WORKSPACE_DETAIL_MAX,
  APP_WORKSPACE_DETAIL_MIN,
  APP_WORKSPACE_DRAWER_MAX,
  APP_WORKSPACE_DRAWER_MIN,
  APP_WORKSPACE_SIDEBAR_COLLAPSED,
  APP_WORKSPACE_SIDEBAR_MAX,
  APP_WORKSPACE_SIDEBAR_MIN,
  type AppWorkspaceLayoutState,
  type AppWorkspaceResizeKind,
  appWorkspaceCookieName,
  appWorkspacePanelVariable,
  appWorkspaceResizeLimits,
  readAppWorkspaceLayoutCookie,
  resolveAppWorkspaceSidebarWidth,
  safeAppWorkspacePanelId,
  serializeAppWorkspaceLayoutState,
  shouldCollapseAppWorkspaceSidebar,
} from "../ui/misc/app-workspace-state";

type ResizeKind = AppWorkspaceResizeKind;

type ActiveResize = {
  handle: HTMLElement;
  root: HTMLElement;
  kind: ResizeKind;
  pointerId: number;
  startClient: number;
  startSize: number;
  previousUserSelect: string;
};

const HANDLE_SELECTOR = "[data-app-workspace-resize]";
const LABEL_SELECTOR = "[data-app-workspace-label]";

const clamp = (value: number, min: number, max: number): number => Math.round(Math.min(max, Math.max(min, value)));

const eventElement = (event: Event): Element | null => (event.target instanceof Element ? event.target : null);

const resizeHandle = (event: Event): HTMLElement | null => eventElement(event)?.closest<HTMLElement>(HANDLE_SELECTOR) ?? null;

const resizeKind = (handle: HTMLElement): ResizeKind | null => {
  const value = handle.dataset.appWorkspaceResize;
  return value === "sidebar" || value === "detail" || value === "drawer" ? value : null;
};

const workspaceRoot = (handle: HTMLElement): HTMLElement | null => handle.closest<HTMLElement>(".app-workspace");

const workspaceCanvas = (root: HTMLElement): HTMLElement => root.closest<HTMLElement>(".cloud-app-canvas") ?? root;

const rootElements = (root: HTMLElement, selector: string): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((element) => element.closest(".app-workspace") === root);

const sidebarElement = (root: HTMLElement): HTMLElement | null => rootElements(root, ".workspace-sidebar")[0] ?? null;

const sidebarCollapsible = (root: HTMLElement): boolean => sidebarElement(root)?.dataset.workspaceCollapsible === "true";

const isVisible = (element: HTMLElement | null): element is HTMLElement =>
  !!element && getComputedStyle(element).display !== "none" && !element.hidden;

const elementSize = (element: HTMLElement | null, kind: ResizeKind): number => {
  if (!isVisible(element)) return 0;
  const rect = element.getBoundingClientRect();
  return kind === "drawer" ? rect.height : rect.width;
};

const controlledPanel = (root: HTMLElement, handle: HTMLElement): HTMLElement | null => {
  const controls = handle.getAttribute("aria-controls");
  if (!controls) return null;
  const panel = document.getElementById(controls);
  return panel?.closest(".app-workspace") === root ? panel : null;
};

const panelId = (handle: HTMLElement): string => safeAppWorkspacePanelId(handle.dataset.workspacePanelId ?? "primary") || "primary";

const numberData = (handle: HTMLElement, key: "workspaceMinSize" | "workspaceMaxSize", fallback: number): number => {
  const value = Number(handle.dataset[key]);
  return Number.isFinite(value) ? value : fallback;
};

const sizeLimits = (root: HTMLElement, handle: HTMLElement, kind: ResizeKind): { min: number; max: number } => {
  const controlled = controlledPanel(root, handle);
  const details = rootElements(root, ".workspace-detail").filter(isVisible);
  const sidebarWidth = elementSize(sidebarElement(root), "sidebar");
  const otherDetailWidth = details.reduce((total, detail) => total + (detail === controlled ? 0 : elementSize(detail, "detail")), 0);
  const defaultMin =
    kind === "sidebar" ? APP_WORKSPACE_SIDEBAR_MIN : kind === "detail" ? APP_WORKSPACE_DETAIL_MIN : APP_WORKSPACE_DRAWER_MIN;
  const defaultMax =
    kind === "sidebar" ? APP_WORKSPACE_SIDEBAR_MAX : kind === "detail" ? APP_WORKSPACE_DETAIL_MAX : APP_WORKSPACE_DRAWER_MAX;
  return appWorkspaceResizeLimits({
    kind,
    workspaceSize: kind === "drawer" ? root.getBoundingClientRect().height : root.getBoundingClientRect().width,
    reservedSize: kind === "sidebar" ? otherDetailWidth : kind === "detail" ? sidebarWidth + otherDetailWidth : 0,
    min: numberData(handle, "workspaceMinSize", defaultMin),
    max: numberData(handle, "workspaceMaxSize", defaultMax),
    sidebarCollapsible: kind === "sidebar" && sidebarCollapsible(root),
  });
};

const currentSize = (root: HTMLElement, handle: HTMLElement, kind: ResizeKind): number =>
  kind === "sidebar" ? elementSize(sidebarElement(root), kind) : elementSize(controlledPanel(root, handle), kind);

const updateHandleValue = (root: HTMLElement, handle: HTMLElement, kind: ResizeKind, size: number) => {
  const { min, max } = sizeLimits(root, handle, kind);
  handle.setAttribute("aria-valuemin", String(min));
  handle.setAttribute("aria-valuemax", String(max));
  handle.setAttribute("aria-valuenow", String(clamp(size, min, max)));
};

const sidebarSnapTimers = new Map<HTMLElement, number>();

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

const applySize = (
  root: HTMLElement,
  handle: HTMLElement,
  kind: ResizeKind,
  requestedSize: number,
  options: { snapSidebar?: boolean; animateSidebar?: boolean } = {},
): number => {
  const { min, max } = sizeLimits(root, handle, kind);
  if (kind === "sidebar") {
    const canvas = workspaceCanvas(root);
    const previousCollapsed = canvas.dataset.workspaceSidebarCollapsed === "true";
    const shouldSnap = options.snapSidebar ?? true;
    const sidebar = shouldSnap
      ? resolveAppWorkspaceSidebarWidth(requestedSize, max, sidebarCollapsible(root))
      : {
          width: clamp(requestedSize, min, max),
          collapsed: shouldCollapseAppWorkspaceSidebar(requestedSize, sidebarCollapsible(root)),
        };
    if (sidebar.collapsed) canvas.dataset.workspaceSidebarCollapsed = "true";
    else delete canvas.dataset.workspaceSidebarCollapsed;
    if (options.animateSidebar !== false && sidebar.collapsed !== previousCollapsed) markSidebarSnap(root);
    canvas.style.setProperty("--workspace-sidebar-width", `${sidebar.width}px`);
    updateHandleValue(root, handle, kind, sidebar.width);
    return sidebar.width;
  }

  const size = clamp(requestedSize, min, max);
  workspaceCanvas(root).style.setProperty(appWorkspacePanelVariable(kind, panelId(handle)), `${size}px`);
  updateHandleValue(root, handle, kind, size);
  return size;
};

const readClientState = (appId: string | null): AppWorkspaceLayoutState => {
  if (!appId) return { version: 2 };
  return readAppWorkspaceLayoutCookie(document.cookie, appId) ?? { version: 2 };
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

  const persistSize = (handle: HTMLElement, kind: ResizeKind, size: number) => {
    if (kind === "sidebar") {
      const collapsed = size === APP_WORKSPACE_SIDEBAR_COLLAPSED;
      layoutState = {
        ...layoutState,
        version: 2,
        sidebarWidth: collapsed ? layoutState.sidebarWidth : size,
        sidebarCollapsed: collapsed,
      };
    } else if (kind === "detail") {
      layoutState = {
        ...layoutState,
        version: 2,
        detailWidths: { ...layoutState.detailWidths, [panelId(handle)]: size },
      };
    } else {
      layoutState = {
        ...layoutState,
        version: 2,
        drawerHeights: { ...layoutState.drawerHeights, [panelId(handle)]: size },
      };
    }
    writeClientState(appId, layoutState);
  };

  const stopResize = (event?: Event) => {
    if (!active || (event instanceof PointerEvent && event.pointerId !== active.pointerId)) return;
    const finished = active;
    active = null;
    delete finished.root.dataset.workspaceResizeActive;
    const size = applySize(finished.root, finished.handle, finished.kind, currentSize(finished.root, finished.handle, finished.kind));
    persistSize(finished.handle, finished.kind, size);
    if (finished.handle.hasPointerCapture?.(finished.pointerId)) finished.handle.releasePointerCapture(finished.pointerId);
    document.body.style.userSelect = finished.previousUserSelect;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
    window.removeEventListener("blur", stopResize);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return;
    const currentClient = active.kind === "drawer" ? event.clientY : event.clientX;
    const delta = currentClient - active.startClient;
    const requested = active.kind === "sidebar" ? active.startSize + delta : active.startSize - delta;
    applySize(active.root, active.handle, active.kind, requested, { snapSidebar: active.kind !== "sidebar" });
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
      startClient: kind === "drawer" ? event.clientY : event.clientX,
      startSize: currentSize(root, handle, kind),
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

    const current = currentSize(root, handle, kind);
    const { min, max } = sizeLimits(root, handle, kind);
    const step = event.shiftKey ? 32 : 8;
    let requested: number | null = null;
    if (event.key === "Home") requested = min;
    else if (event.key === "End") requested = max;
    else if (kind === "drawer" && event.key === "ArrowUp") requested = current + step;
    else if (kind === "drawer" && event.key === "ArrowDown") requested = current - step;
    else if (kind !== "drawer" && event.key === "ArrowLeft") {
      requested =
        kind === "sidebar" && sidebarCollapsible(root) && current <= APP_WORKSPACE_SIDEBAR_MIN
          ? APP_WORKSPACE_SIDEBAR_COLLAPSED
          : kind === "sidebar"
            ? current - step
            : current + step;
    } else if (kind !== "drawer" && event.key === "ArrowRight") {
      requested =
        kind === "sidebar" && sidebarCollapsible(root) && current <= APP_WORKSPACE_SIDEBAR_COLLAPSED
          ? (layoutState.sidebarWidth ?? APP_WORKSPACE_SIDEBAR_MIN)
          : kind === "sidebar"
            ? current + step
            : current - step;
    }
    if (requested === null) return;

    event.preventDefault();
    persistSize(handle, kind, applySize(root, handle, kind, requested));
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
    if (handle && kind && root) updateHandleValue(root, handle, kind, currentSize(root, handle, kind));

    const label = eventElement(event)?.closest<HTMLElement>("[data-app-workspace-item]")?.querySelector<HTMLElement>(LABEL_SELECTOR);
    if (label) requestAnimationFrame(() => measureLabel(label));
  };

  const clearMeasuredLabels = () => {
    document.querySelectorAll<HTMLElement>(LABEL_SELECTOR).forEach((label) => {
      delete label.dataset.overflow;
      label.style.removeProperty("--sidebar-label-overflow");
    });
  };

  const workspaceRoots = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>(".app-workspace")).filter(
      (root) => getComputedStyle(root).display !== "none" && root.getBoundingClientRect().width > 0,
    );

  const rootHandles = (root: HTMLElement): HTMLElement[] =>
    rootElements(root, HANDLE_SELECTOR).filter((handle) => resizeKind(handle) !== null);

  const reconcilePersistedSizes = () => {
    workspaceRoots().forEach((root) => {
      rootHandles(root).forEach((handle) => {
        const kind = resizeKind(handle)!;
        let persisted: number | undefined;
        if (kind === "sidebar") {
          persisted = layoutState.sidebarCollapsed && sidebarCollapsible(root) ? APP_WORKSPACE_SIDEBAR_COLLAPSED : layoutState.sidebarWidth;
        } else if (kind === "detail") {
          persisted = layoutState.detailWidths?.[panelId(handle)];
        } else {
          persisted = layoutState.drawerHeights?.[panelId(handle)];
        }
        if (persisted !== undefined) applySize(root, handle, kind, persisted, { animateSidebar: false });
        else updateHandleValue(root, handle, kind, currentSize(root, handle, kind));
      });
    });
  };

  let resizeFrame: number | null = null;
  const onWindowResize = () => {
    clearMeasuredLabels();
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      reconcilePersistedSizes();
    });
  };

  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerover", onPointerOver);
  document.addEventListener("focusin", onFocusIn);
  window.addEventListener("resize", onWindowResize);
  const initialSyncFrame = requestAnimationFrame(reconcilePersistedSizes);

  return () => {
    cancelAnimationFrame(initialSyncFrame);
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    stopResize();
    sidebarSnapTimers.forEach((timer) => window.clearTimeout(timer));
    sidebarSnapTimers.clear();
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointerover", onPointerOver);
    document.removeEventListener("focusin", onFocusIn);
    window.removeEventListener("resize", onWindowResize);
  };
};
