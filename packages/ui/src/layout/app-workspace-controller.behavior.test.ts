import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window as HappyWindow } from "happy-dom";
import { APP_WORKSPACE_SIDEBAR_COLLAPSED } from "./app-workspace-state";
import { installAppWorkspaceController } from "./app-workspace-controller";

type Frame = (time: number) => void;
type Rect = { height: number; width: number };

let window: HappyWindow;
let frames: Map<number, Frame>;
let frameId = 0;
const previousGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();
const globalKeys = [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "PointerEvent",
  "KeyboardEvent",
  "FocusEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const;

const setRect = (element: Element, rect: Rect) => {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: rect.height,
      height: rect.height,
      left: 0,
      right: rect.width,
      toJSON: () => ({}),
      top: 0,
      width: rect.width,
      x: 0,
      y: 0,
    }),
  });
};

const flushFrames = () => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
};

const workspace = (options: {
  collapsible?: boolean;
  height?: number;
  resizable?: boolean;
  sidebarWidth?: number;
  width?: number;
} = {}) => {
  const root = document.createElement("div");
  root.dataset.k2bAppWorkspace = "";
  root.dataset.workspaceResizable = options.resizable === false ? "false" : "true";
  setRect(root, { height: options.height ?? 700, width: options.width ?? 1000 });

  const sidebar = document.createElement("aside");
  sidebar.className = "k2b-app-workspace__sidebar";
  sidebar.dataset.workspaceResizable = "true";
  sidebar.dataset.workspaceCollapsible = options.collapsible ? "true" : "false";
  setRect(sidebar, { height: 700, width: options.sidebarWidth ?? 176 });
  root.append(sidebar);

  const handle = document.createElement("button");
  handle.dataset.appWorkspaceResize = "sidebar";
  handle.dataset.workspaceResizeEdge = "end";
  sidebar.append(handle);
  document.body.append(root);

  return { handle, root, sidebar };
};

const dispatchKey = (element: Element, key: string) => {
  element.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key }) as unknown as Event);
};

beforeEach(() => {
  window = new HappyWindow({ url: "https://ui.test/" });
  frames = new Map();
  frameId = 0;
  for (const key of globalKeys) previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.assign(globalThis, {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    PointerEvent: window.PointerEvent,
    KeyboardEvent: window.KeyboardEvent,
    FocusEvent: window.FocusEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (callback: Frame) => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
});

afterEach(() => {
  window.close();
  for (const key of globalKeys) {
    const descriptor = previousGlobals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  previousGlobals.clear();
});

describe("AppWorkspace resize controller behaviour", () => {
  test("collapses from the sidebar minimum and restores the remembered width", () => {
    const { handle, root, sidebar } = workspace({ collapsible: true });
    const written: unknown[] = [];
    const dispose = installAppWorkspaceController({
      root,
      readState: () => ({ version: 2, sidebarWidth: 248, sidebarCollapsed: false }),
      writeState: (state) => written.push(state),
    });

    dispatchKey(handle, "ArrowLeft");
    expect(root.style.getPropertyValue("--k2b-workspace-sidebar-width")).toBe(`${APP_WORKSPACE_SIDEBAR_COLLAPSED}px`);
    expect(root.dataset.sidebarCollapsed).toBe("true");
    expect(written.at(-1)).toMatchObject({ sidebarWidth: 248, sidebarCollapsed: true });

    setRect(sidebar, { height: 700, width: APP_WORKSPACE_SIDEBAR_COLLAPSED });
    dispatchKey(handle, "ArrowRight");
    expect(root.style.getPropertyValue("--k2b-workspace-sidebar-width")).toBe("248px");
    expect(root.dataset.sidebarCollapsed).toBeUndefined();
    expect(written.at(-1)).toMatchObject({ sidebarWidth: 248, sidebarCollapsed: false });
    dispose();
  });

  test("applies vertical arrow steps relative to the drawer handle edge", () => {
    const { root } = workspace({ height: 900 });
    const panel = document.createElement("section");
    panel.id = "activity";
    panel.dataset.workspaceResizable = "true";
    setRect(panel, { height: 320, width: 1000 });
    root.append(panel);
    const handle = document.createElement("button");
    handle.dataset.appWorkspaceResize = "drawer";
    handle.dataset.workspacePanelId = "activity";
    handle.dataset.workspaceResizeEdge = "end";
    handle.setAttribute("aria-controls", panel.id);
    root.append(handle);
    const dispose = installAppWorkspaceController({ root });

    dispatchKey(handle, "ArrowUp");
    expect(root.style.getPropertyValue("--k2b-workspace-drawer-activity-height")).toBe("312px");

    handle.dataset.workspaceResizeEdge = "start";
    dispatchKey(handle, "ArrowUp");
    expect(root.style.getPropertyValue("--k2b-workspace-drawer-activity-height")).toBe("328px");
    dispose();
  });

  test("tracks a live sidebar pointer continuously before applying its snap", () => {
    const { handle, root } = workspace({ collapsible: true });
    const dispose = installAppWorkspaceController({ root });

    handle.dispatchEvent(
      new window.PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 176,
        pointerId: 7,
      }) as unknown as Event,
    );
    window.dispatchEvent(new window.PointerEvent("pointermove", { clientX: 206, pointerId: 7 }));

    expect(root.style.getPropertyValue("--k2b-workspace-sidebar-width")).toBe("206px");
    expect(root.dataset.workspaceResizeActive).toBe("sidebar");
    dispose();
  });

  test("does not reconcile a hidden, zero-width or locked workspace", () => {
    for (const mode of ["hidden", "zero", "locked"] as const) {
      const { root } = workspace({
        resizable: mode !== "locked",
        width: mode === "zero" ? 0 : 1000,
      });
      if (mode === "hidden") root.style.display = "none";
      const dispose = installAppWorkspaceController({
        root,
        readState: () => ({ version: 2, sidebarWidth: 248 }),
      });
      flushFrames();
      expect(root.style.getPropertyValue("--k2b-workspace-sidebar-width"), mode).toBe("");
      dispose();
      root.remove();
    }
  });

  test("measures marquee labels lazily and clears cached geometry on resize", () => {
    const { root, sidebar } = workspace();
    const item = document.createElement("div");
    item.className = "k2b-app-workspace__sidebar-item";
    const label = document.createElement("span");
    label.className = "k2b-app-workspace__sidebar-item-label";
    label.dataset.marquee = "true";
    Object.defineProperty(label, "clientWidth", { configurable: true, value: 80 });
    const text = document.createElement("span");
    text.className = "k2b-app-workspace__sidebar-item-label-text";
    Object.defineProperty(text, "scrollWidth", { configurable: true, value: 120 });
    label.append(text);
    item.append(label);
    sidebar.append(item);
    const dispose = installAppWorkspaceController({ root });

    label.dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true }) as unknown as Event);
    flushFrames();
    expect(label.dataset.overflow).toBe("true");
    expect(label.style.getPropertyValue("--k2b-sidebar-label-overflow")).toBe("40px");

    window.dispatchEvent(new window.Event("resize"));
    expect(label.dataset.overflow).toBeUndefined();
    expect(label.style.getPropertyValue("--k2b-sidebar-label-overflow")).toBe("");
    dispose();
  });

  test("refreshes handle values on focus and removes listeners on dispose", () => {
    const { handle, root } = workspace({ sidebarWidth: 220 });
    const dispose = installAppWorkspaceController({ root });

    handle.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }) as unknown as Event);
    expect(handle.getAttribute("aria-valuenow")).toBe("220");
    dispose();

    dispatchKey(handle, "ArrowRight");
    expect(root.style.getPropertyValue("--k2b-workspace-sidebar-width")).toBe("");
  });
});
