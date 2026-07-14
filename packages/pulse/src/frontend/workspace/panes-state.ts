import { normalizePanesValue, type PanesNode, type PanesValue } from "@valentinkolb/cloud/ui";

export const QUERY_EXPLORER_PANES_KEY = "pulse.query-explorer";
export const DASHBOARD_EDITOR_PANES_KEY = "pulse.dashboard-editor";

export const QUERY_EXPLORER_ELEMENT_IDS = ["result", "editor", "browse", "saved", "history"];
export const DASHBOARD_EDITOR_ELEMENT_IDS = ["preview", "editor", "inventory", "diagnostics"];

const cookieName = (storageKey: string) => `pulse_panes_${storageKey.replace(/[^A-Za-z0-9_-]/g, "_")}`;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 32 && value.every((item) => typeof item === "string" && item.length > 0);

const isPanesNode = (value: unknown, depth = 0): value is PanesNode => {
  if (!value || typeof value !== "object" || depth > 8) return false;
  const node = value as Record<string, unknown>;
  if (typeof node.id !== "string" || !node.id) return false;
  if (node.type === "leaf") {
    return (
      isStringArray(node.elementIds) &&
      (node.activeElementId === undefined || typeof node.activeElementId === "string") &&
      (node.presentation === undefined || node.presentation === "single" || node.presentation === "tabs" || node.presentation === "stack")
    );
  }
  if (node.type !== "split" || (node.direction !== "horizontal" && node.direction !== "vertical")) return false;
  if (!Array.isArray(node.children) || node.children.length < 2 || node.children.length > 16) return false;
  if (
    !Array.isArray(node.sizes) ||
    node.sizes.length !== node.children.length ||
    !node.sizes.every((size) => typeof size === "number" && Number.isFinite(size))
  ) {
    return false;
  }
  return node.children.every((child) => isPanesNode(child, depth + 1));
};

export const createQueryExplorerPanesValue = (): PanesValue => ({
  root: {
    type: "split",
    id: "pulse-query-root",
    direction: "vertical",
    sizes: [42, 58],
    children: [
      {
        type: "leaf",
        id: "pulse-query-result",
        elementIds: ["result"],
        activeElementId: "result",
        presentation: "single",
      },
      {
        type: "split",
        id: "pulse-query-bottom",
        direction: "horizontal",
        sizes: [68, 32],
        children: [
          {
            type: "leaf",
            id: "pulse-query-editor",
            elementIds: ["editor"],
            activeElementId: "editor",
            presentation: "single",
          },
          {
            type: "leaf",
            id: "pulse-query-context",
            elementIds: ["browse", "saved", "history"],
            activeElementId: "browse",
            presentation: "tabs",
          },
        ],
      },
    ],
  },
});

export const createDashboardEditorPanesValue = (): PanesValue => ({
  root: {
    type: "split",
    id: "pulse-dashboard-root",
    direction: "vertical",
    sizes: [48, 52],
    children: [
      {
        type: "leaf",
        id: "pulse-dashboard-preview",
        elementIds: ["preview"],
        activeElementId: "preview",
        presentation: "single",
      },
      {
        type: "split",
        id: "pulse-dashboard-bottom",
        direction: "horizontal",
        sizes: [68, 32],
        children: [
          {
            type: "leaf",
            id: "pulse-dashboard-editor",
            elementIds: ["editor"],
            activeElementId: "editor",
            presentation: "single",
          },
          {
            type: "leaf",
            id: "pulse-dashboard-context",
            elementIds: ["inventory", "diagnostics"],
            activeElementId: "inventory",
            presentation: "tabs",
          },
        ],
      },
    ],
  },
});

export const readPulsePanesStateCookie = (cookieHeader: string | null | undefined, storageKey: string): PanesValue | null => {
  if (!cookieHeader) return null;
  const name = cookieName(storageKey);
  const encoded = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as unknown;
    return parsed && typeof parsed === "object" && "root" in parsed && isPanesNode((parsed as { root: unknown }).root)
      ? (parsed as PanesValue)
      : null;
  } catch {
    return null;
  }
};

export const initialPulsePanesValue = (persisted: PanesValue | null | undefined, fallback: PanesValue, elementIds: string[]): PanesValue =>
  normalizePanesValue(persisted ?? fallback, elementIds);

export const persistPulsePanesValue = (storageKey: string, value: PanesValue) => {
  if (typeof document === "undefined") return;
  const encoded = encodeURIComponent(JSON.stringify(value));
  document.cookie = `${cookieName(storageKey)}=${encoded}; Path=/; Max-Age=31536000; SameSite=Lax`;
};
