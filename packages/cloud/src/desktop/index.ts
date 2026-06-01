export type DesktopPlatform = "browser" | "macos" | "linux" | "windows";
export type DesktopRuntime = "browser" | "electrobun";
export type DesktopWindowControls = "browser" | "native-inset" | "system-titlebar" | "custom";

export type DesktopEnvironment = {
  runtime: DesktopRuntime;
  platform: DesktopPlatform;
  windowControls: DesktopWindowControls;
  supportsNativeDialogs: boolean;
  supportsNativeMenus: boolean;
  supportsContextMenus: boolean;
};

export type DesktopResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type DesktopFileDialogOptions = {
  multiple?: boolean;
  directories?: boolean;
  files?: boolean;
  startingFolder?: string;
};

export type DesktopFileDialogResult = {
  paths: string[];
};

export type DesktopMessageOptions = {
  type?: "info" | "warning" | "error" | "question";
  title?: string;
  message: string;
  detail?: string;
  buttons?: string[];
};

export type DesktopMessageResult = {
  buttonIndex?: number;
};

export type DesktopNotificationOptions = {
  title: string;
  subtitle?: string;
  body?: string;
};

export type DesktopContextMenuItem = { type: "divider" } | { label: string; action?: string; role?: string; enabled?: boolean };

export const desktopWindowDescriptorKind = "cloud-desktop-window" as const;
export const desktopWindowSearchParams = {
  name: "__cloudDesktopWindow",
  props: "__cloudDesktopWindowProps",
} as const;

export type DesktopWindowDescriptor = {
  kind: typeof desktopWindowDescriptorKind;
  name: string;
  props: string;
};

export type DesktopWindowOpenOptions = {
  title?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  activate?: boolean;
};

export type DesktopWindowOpenInput = {
  descriptor: DesktopWindowDescriptor;
  options?: DesktopWindowOpenOptions;
};

export type DesktopWindowIdInput = {
  id: string;
};

export type DesktopWindowSetTitleInput = DesktopWindowIdInput & {
  title: string;
};

export type DesktopWindowRefData = {
  id: string;
};

export type DesktopWindowRef = DesktopWindowRefData & {
  close: () => Promise<void>;
  focus: () => Promise<void>;
  setTitle: (title: string) => Promise<void>;
};

export type DesktopBridge = {
  getEnvironment?: () => Promise<DesktopResult<DesktopEnvironment>>;
  openFileDialog?: (options?: DesktopFileDialogOptions) => Promise<DesktopResult<DesktopFileDialogResult>>;
  showMessage?: (options: DesktopMessageOptions) => Promise<DesktopResult<DesktopMessageResult>>;
  showNotification?: (options: DesktopNotificationOptions) => Promise<DesktopResult<void>>;
  clipboardWriteText?: (value: string) => Promise<DesktopResult<void>>;
  clipboardReadText?: () => Promise<DesktopResult<string>>;
  showContextMenu?: (items: DesktopContextMenuItem[]) => Promise<DesktopResult<void>>;
  openExternal?: (url: string) => Promise<DesktopResult<boolean>>;
  closeWindow?: () => Promise<DesktopResult<void>>;
  minimizeWindow?: () => Promise<DesktopResult<void>>;
  maximizeWindow?: () => Promise<DesktopResult<void>>;
  getCurrentWindowDescriptor?: () => Promise<DesktopResult<DesktopWindowDescriptor | null>>;
  openWindow?: (input: DesktopWindowOpenInput) => Promise<DesktopResult<DesktopWindowRefData>>;
  closeWindowById?: (input: DesktopWindowIdInput) => Promise<DesktopResult<void>>;
  focusWindow?: (input: DesktopWindowIdInput) => Promise<DesktopResult<void>>;
  setWindowTitle?: (input: DesktopWindowSetTitleInput) => Promise<DesktopResult<void>>;
};

export type DesktopAppMenuItem =
  | { type: "divider" }
  | { role: string }
  | { label: string; action?: string; onClick?: (ctx: DesktopActionContext) => void | Promise<void>; enabled?: boolean };

export type DesktopAppMenu = Array<{
  label: string;
  items: DesktopAppMenuItem[];
}>;

export type DesktopAppConfig = {
  name: string;
  identifier: string;
  version?: string;
  routing?: "path" | "hash" | "none";
  window?: {
    width?: number;
    height?: number;
    titleBar?: "default" | "hidden-inset" | "hidden" | "custom";
  };
  menu?: DesktopAppMenu;
};

export type DesktopActionContext = {
  desktop: typeof desktop;
};

export type DesktopSql = (<Row = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => Row[]) & {
  transaction: <T>(fn: () => T) => T;
  db: unknown;
};

const browserEnvironment: DesktopEnvironment = {
  runtime: "browser",
  platform: "browser",
  windowControls: "browser",
  supportsNativeDialogs: false,
  supportsNativeMenus: false,
  supportsContextMenus: false,
};

let bridgeOverride: DesktopBridge | null = null;

const hasWindow = () => typeof window !== "undefined";

const bridge = (): DesktopBridge | null => bridgeOverride ?? (hasWindow() ? (window.cloudDesktopRuntime ?? null) : null);

const unsupported = async <T>(label: string): Promise<DesktopResult<T>> => ({
  ok: false,
  error: `${label} requires a desktop runtime.`,
});

const unwrap = async <T>(result: Promise<DesktopResult<T>>): Promise<T> => {
  const value = await result;
  if (!value.ok) throw new Error(value.error);
  return value.data;
};

const emitNavigation = () => {
  if (!hasWindow()) return;
  window.dispatchEvent(new CustomEvent("cloud-desktop:navigation"));
};

const isDesktopWindowDescriptor = (value: unknown): value is DesktopWindowDescriptor =>
  Boolean(
    value &&
      typeof value === "object" &&
      (value as { kind?: unknown }).kind === desktopWindowDescriptorKind &&
      typeof (value as { name?: unknown }).name === "string" &&
      typeof (value as { props?: unknown }).props === "string",
  );

const descriptorUrl = (descriptor: DesktopWindowDescriptor): string => {
  const url = hasWindow() ? new URL(window.location.href) : new URL("http://desktop.local/");
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  params.set(desktopWindowSearchParams.name, descriptor.name);
  params.set(desktopWindowSearchParams.props, descriptor.props);
  url.hash = params.toString();
  return `${url.pathname}${url.search}${url.hash}`;
};

export const readDesktopWindowDescriptor = (): DesktopWindowDescriptor | null => {
  if (!hasWindow()) return null;
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.search);
  const name = params.get(desktopWindowSearchParams.name);
  const props = params.get(desktopWindowSearchParams.props);
  return name && props ? { kind: desktopWindowDescriptorKind, name, props } : null;
};

const windowRef = (data: DesktopWindowRefData, browserWindow?: Window | null): DesktopWindowRef => ({
  id: data.id,
  close: () =>
    browserWindow
      ? Promise.resolve(browserWindow.close())
      : unwrap(bridge()?.closeWindowById?.({ id: data.id }) ?? unsupported("Native windows")),
  focus: () =>
    browserWindow
      ? Promise.resolve(browserWindow.focus())
      : unwrap(bridge()?.focusWindow?.({ id: data.id }) ?? unsupported("Native windows")),
  setTitle: (title) =>
    browserWindow
      ? Promise.resolve(undefined)
      : unwrap(bridge()?.setWindowTitle?.({ id: data.id, title }) ?? unsupported("Native windows")),
});

const runtimeRequire = (): ((id: string) => unknown) | null => {
  const importMetaRequire = (import.meta as unknown as { require?: (id: string) => unknown }).require;
  if (importMetaRequire) return importMetaRequire;
  try {
    return Function("return typeof require === 'function' ? require : null")() as ((id: string) => unknown) | null;
  } catch {
    return null;
  }
};

let sqlInstance: DesktopSql | null = null;

const sqlUnavailable = (): never => {
  throw new Error("desktop.sql is only available in the Bun desktop process.");
};

const getSql = (): DesktopSql => {
  if (sqlInstance) return sqlInstance;
  const req = runtimeRequire();
  if (!req || typeof window !== "undefined") throw new Error("desktop.sql is only available in the Bun desktop process.");
  const requireFn = req as (id: string) => unknown;

  const { Database } = requireFn("bun:sqlite") as { Database: new (path: string) => any };
  const { dirname, resolve } = requireFn("node:path") as typeof import("node:path");
  const { mkdirSync } = requireFn("node:fs") as typeof import("node:fs");
  const dbPath = process.env.CLOUD_DESKTOP_SQLITE_PATH ?? resolve(process.cwd(), ".local", "desktop.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.reduce((query, chunk, index) => `${query}${chunk}${index < values.length ? "?" : ""}`, "");
    const prepared = db.query(statement);
    const firstWord = statement.trimStart().split(/\s+/, 1)[0]?.toLowerCase();
    if (firstWord === "select" || firstWord === "pragma" || firstWord === "with") return prepared.all(...values);
    prepared.run(...values);
    return [];
  }) as DesktopSql;

  sql.transaction = (fn) => db.transaction(fn)();
  Object.defineProperty(sql, "db", { value: db, enumerable: true });
  sqlInstance = sql;
  return sql;
};

export const defineDesktopApp = <Config extends DesktopAppConfig>(config: Config): Config => config;

export const installDesktopBridge = (nextBridge: DesktopBridge | null): void => {
  bridgeOverride = nextBridge;
  if (hasWindow()) window.cloudDesktopRuntime = nextBridge ?? undefined;
};

export const desktop = {
  get env(): DesktopEnvironment {
    return hasWindow() ? (window.cloudDesktopEnvironment ?? browserEnvironment) : browserEnvironment;
  },

  get sql(): DesktopSql {
    return getSql();
  },

  navigate: (href: string, options: { replace?: boolean } = {}): void => {
    if (!hasWindow()) return;
    if (options.replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    emitNavigation();
  },

  back: (): void => {
    if (hasWindow()) window.history.back();
  },

  forward: (): void => {
    if (hasWindow()) window.history.forward();
  },

  environment: {
    get: async (): Promise<DesktopEnvironment> => {
      const result = await (bridge()?.getEnvironment?.() ?? Promise.resolve({ ok: true as const, data: browserEnvironment }));
      if (result.ok && hasWindow()) window.cloudDesktopEnvironment = result.data;
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
  },

  dialog: {
    openFile: (options?: DesktopFileDialogOptions): Promise<DesktopFileDialogResult> =>
      unwrap(bridge()?.openFileDialog?.(options) ?? unsupported("Native file dialogs")),
  },

  message: {
    show: (options: DesktopMessageOptions): Promise<DesktopMessageResult> =>
      unwrap(bridge()?.showMessage?.(options) ?? unsupported("Native message boxes")),
    info: (message: string, options: Omit<DesktopMessageOptions, "message" | "type"> = {}): Promise<DesktopMessageResult> =>
      desktop.message.show({ ...options, message, type: "info" }),
    warning: (message: string, options: Omit<DesktopMessageOptions, "message" | "type"> = {}): Promise<DesktopMessageResult> =>
      desktop.message.show({ ...options, message, type: "warning" }),
    error: (message: string, options: Omit<DesktopMessageOptions, "message" | "type"> = {}): Promise<DesktopMessageResult> =>
      desktop.message.show({ ...options, message, type: "error" }),
  },

  notification: {
    show: (options: DesktopNotificationOptions): Promise<void> =>
      unwrap(bridge()?.showNotification?.(options) ?? unsupported("Native notifications")),
  },

  clipboard: {
    writeText: (value: string): Promise<void> => unwrap(bridge()?.clipboardWriteText?.(value) ?? unsupported("Native clipboard access")),
    readText: (): Promise<string> => unwrap(bridge()?.clipboardReadText?.() ?? unsupported("Native clipboard access")),
  },

  contextMenu: {
    show: (items: DesktopContextMenuItem[]): Promise<void> =>
      unwrap(bridge()?.showContextMenu?.(items) ?? unsupported("Native context menus")),
  },

  external: {
    open: (url: string): Promise<boolean> => unwrap(bridge()?.openExternal?.(url) ?? unsupported("Native external URL opening")),
  },

  window: {
    close: (): Promise<void> => unwrap(bridge()?.closeWindow?.() ?? unsupported("Native window controls")),
    minimize: (): Promise<void> => unwrap(bridge()?.minimizeWindow?.() ?? unsupported("Native window controls")),
    maximize: (): Promise<void> => unwrap(bridge()?.maximizeWindow?.() ?? unsupported("Native window controls")),
    current: async (): Promise<DesktopWindowDescriptor | null> => {
      const fromUrl = readDesktopWindowDescriptor();
      if (fromUrl) return fromUrl;
      return unwrap(bridge()?.getCurrentWindowDescriptor?.() ?? Promise.resolve({ ok: true as const, data: null }));
    },
    open: async (view: unknown, options: DesktopWindowOpenOptions = {}): Promise<DesktopWindowRef> => {
      if (!isDesktopWindowDescriptor(view)) throw new Error("desktop.window.open expects a desktop window component.");
      const nativeOpen = bridge()?.openWindow;
      if (nativeOpen) return windowRef(await unwrap(nativeOpen({ descriptor: view, options })));
      if (!hasWindow()) return windowRef(await unwrap(unsupported<DesktopWindowRefData>("Native windows")));
      const child = window.open(descriptorUrl(view), "_blank", `popup,width=${options.width ?? 900},height=${options.height ?? 720}`);
      if (!child) throw new Error("The browser blocked the new window.");
      return windowRef({ id: "browser" }, child);
    },
  },
};

declare global {
  interface Window {
    cloudDesktopRuntime?: DesktopBridge;
    cloudDesktopEnvironment?: DesktopEnvironment;
  }
}
