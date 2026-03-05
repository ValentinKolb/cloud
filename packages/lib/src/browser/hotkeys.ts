import { createSignal, getOwner, onCleanup, onMount, type Accessor } from "solid-js";

const MODIFIER_PRIORITY = new Map<string, number>([
  ["mod", 0],
  ["meta", 0],
  ["ctrl", 0],
  ["alt", 1],
  ["shift", 2],
]);

const isBrowser = typeof window !== "undefined";
const isMacPlatform =
  isBrowser &&
  (navigator.platform.toLowerCase().includes("mac") ||
    navigator.userAgent.toLowerCase().includes("mac"));

export type PrettyKeyPart = {
  key: string;
  ariaLabel: string;
};

export type HotkeyDefinition = {
  label: string;
  run: () => void | Promise<void>;
  desc?: string;
  inInput?: true;
};

export type HotkeyMap = Record<string, HotkeyDefinition>;

export type RegisteredHotkeyMeta = {
  keys: string;
  keysPretty: PrettyKeyPart[];
  label: string;
  desc?: string;
};

type HotkeyConfig = HotkeyMap | (() => HotkeyMap | Promise<HotkeyMap>);

type RegisteredHotkey = RegisteredHotkeyMeta & {
  id: string;
  runtimeKey: string;
  run: () => void | Promise<void>;
  inInput: boolean;
};

const [entrySignal, setEntrySignal] = createSignal<RegisteredHotkeyMeta[]>([]);
const byId = new Map<string, RegisteredHotkey>();
const byRuntimeKey = new Map<string, string>();
let sequence = 0;
let listenerAttached = false;

const getModifiers = (parts: string[]) =>
  parts.filter((part) => MODIFIER_PRIORITY.has(part)).sort((a, b) => {
    return (MODIFIER_PRIORITY.get(a) ?? 99) - (MODIFIER_PRIORITY.get(b) ?? 99);
  });

const normalizeCombo = (keys: string) => {
  const rawParts = keys
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const modifiers = getModifiers(rawParts);
  const primaryParts = rawParts.filter((part) => !MODIFIER_PRIORITY.has(part));
  if (primaryParts.length !== 1) return null;
  return [...modifiers, primaryParts[0]].join("+");
};

const toRuntimeKey = (logicalKey: string) =>
  logicalKey
    .split("+")
    .map((part) => {
      if (part !== "mod") return part;
      return isMacPlatform ? "meta" : "ctrl";
    })
    .join("+");

const toPrettyPart = (part: string): PrettyKeyPart => {
  if (part === "mod") {
    return isMacPlatform ? { key: "⌘", ariaLabel: "Command" } : { key: "Strg", ariaLabel: "Control" };
  }
  if (part === "shift") {
    return isMacPlatform ? { key: "⇧", ariaLabel: "Shift" } : { key: "Shift", ariaLabel: "Shift" };
  }
  if (part === "alt") {
    return isMacPlatform ? { key: "⌥", ariaLabel: "Option" } : { key: "Alt", ariaLabel: "Alt" };
  }
  if (part === "meta") {
    return { key: "⌘", ariaLabel: "Command" };
  }
  if (part === "ctrl") {
    return { key: "Strg", ariaLabel: "Control" };
  }

  const key = part.length === 1 ? part.toUpperCase() : part;
  const ariaLabel = key.length === 1 ? key : key[0]?.toUpperCase() + key.slice(1);
  return { key, ariaLabel };
};

const toPrettyParts = (logicalKey: string): PrettyKeyPart[] =>
  logicalKey.split("+").map((part) => toPrettyPart(part));

const toKeyboardKey = (event: KeyboardEvent): string | null => {
  const raw = event.key;
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (lower === "control") return "ctrl";
  if (lower === "meta") return "meta";
  if (lower === "alt") return "alt";
  if (lower === "shift") return "shift";
  if (lower === " ") return "space";
  if (lower === "escape") return "esc";

  return lower;
};

const eventToRuntimeKey = (event: KeyboardEvent): string | null => {
  const mainKey = toKeyboardKey(event);
  if (!mainKey || MODIFIER_PRIORITY.has(mainKey)) return null;

  const modifiers: string[] = [];
  if (event.metaKey) modifiers.push("meta");
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");

  return [...getModifiers(modifiers), mainKey].join("+");
};

const isTextTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest("[contenteditable='true']") !== null;
};

const updateEntrySignal = () => {
  setEntrySignal(
    Array.from(byId.values()).map(({ keys, keysPretty, label, desc }) => ({
      keys,
      keysPretty,
      label,
      desc,
    })),
  );
};

const onKeyDown = (event: KeyboardEvent) => {
  if (event.repeat) return;

  const runtimeKey = eventToRuntimeKey(event);
  if (!runtimeKey) return;

  const hotkeyId = byRuntimeKey.get(runtimeKey);
  if (!hotkeyId) return;

  const hotkey = byId.get(hotkeyId);
  if (!hotkey) return;

  const inText = isTextTarget(event.target);
  const hasSystemModifier = event.ctrlKey || event.metaKey || event.altKey;
  if (inText && !hotkey.inInput && !hasSystemModifier) return;

  event.preventDefault();
  try {
    const result = hotkey.run();
    if (result && typeof (result as Promise<void>).then === "function") {
      void (result as Promise<void>).catch((error) => {
        console.error("[hotkeys] handler failed", error);
      });
    }
  } catch (error) {
    console.error("[hotkeys] handler failed", error);
  }
};

const ensureListener = () => {
  if (!isBrowser || listenerAttached || byId.size === 0) return;
  window.addEventListener("keydown", onKeyDown);
  listenerAttached = true;
};

const maybeRemoveListener = () => {
  if (!listenerAttached || byId.size > 0) return;
  window.removeEventListener("keydown", onKeyDown);
  listenerAttached = false;
};

const registerHotkey = (keys: string, definition: HotkeyDefinition): (() => void) => {
  const logicalKey = normalizeCombo(keys);
  if (!logicalKey) {
    console.warn(`[hotkeys] invalid combo "${keys}". Expected exactly one non-modifier key.`);
    return () => {};
  }

  const runtimeKey = toRuntimeKey(logicalKey);
  const duplicate = byRuntimeKey.get(runtimeKey);
  if (duplicate) {
    const existing = byId.get(duplicate);
    console.warn(
      `[hotkeys] duplicate combo "${logicalKey}" ignored (already registered by "${existing?.label ?? duplicate}").`,
    );
    return () => {};
  }

  const id = `hotkey-${++sequence}`;
  const entry: RegisteredHotkey = {
    id,
    keys: logicalKey,
    keysPretty: toPrettyParts(logicalKey),
    label: definition.label,
    desc: definition.desc,
    runtimeKey,
    run: definition.run,
    inInput: definition.inInput === true,
  };

  byId.set(id, entry);
  byRuntimeKey.set(runtimeKey, id);
  updateEntrySignal();
  ensureListener();

  return () => {
    byId.delete(id);
    byRuntimeKey.delete(runtimeKey);
    updateEntrySignal();
    maybeRemoveListener();
  };
};

const resolveConfig = async (config?: HotkeyConfig): Promise<HotkeyMap> => {
  if (!config) return {};
  if (typeof config === "function") return Promise.resolve(config());
  return config;
};

export const createHotkeys = (
  config?: HotkeyConfig,
): {
  entries: Accessor<RegisteredHotkeyMeta[]>;
  dispose: () => void;
} => {
  let disposed = false;
  const unregisterFns: Array<() => void> = [];

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    while (unregisterFns.length > 0) {
      const unregister = unregisterFns.pop();
      unregister?.();
    }
  };

  const registerAll = async () => {
    const map = await resolveConfig(config);
    if (disposed) return;

    for (const [keys, definition] of Object.entries(map)) {
      if (disposed) break;
      unregisterFns.push(registerHotkey(keys, definition));
    }
  };

  const owner = getOwner();
  if (owner) {
    onMount(() => {
      if (!isBrowser) return;
      void registerAll();
    });
    onCleanup(dispose);
  } else if (isBrowser) {
    void registerAll();
  }

  return {
    entries: entrySignal,
    dispose,
  };
};

export const hotkeyEntries = entrySignal;

export const hotkeys = {
  create: createHotkeys,
  entries: hotkeyEntries,
} as const;
