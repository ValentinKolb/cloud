import { createPanesLayout, type PanesLayout, type PanesNode, parsePanesLayout, reconcilePanesLayout } from "@k2b/ui";

export const MAIL_COMPOSER_PANES_COOKIE = "settings-app-mail-composer-panes";

const COMPOSER_PANE_IDS = ["editor", "preview", "history"] as const;

export const createDefaultMailComposerPanesLayout = (): PanesLayout => createPanesLayout(COMPOSER_PANE_IDS);

export const reconcileMailComposerPanes = (layout: PanesLayout, format: "plain" | "markdown", hasConversation: boolean): PanesLayout =>
  reconcilePanesLayout(layout, ["editor", ...(format === "markdown" ? ["preview"] : []), ...(hasConversation ? ["history"] : [])]);

const nodeAllowed = (node: PanesNode): boolean => {
  if (node.type === "group") {
    return node.items.every((item) => COMPOSER_PANE_IDS.includes(item as (typeof COMPOSER_PANE_IDS)[number]));
  }
  return node.direction === "horizontal" && nodeAllowed(node.first) && nodeAllowed(node.second);
};

const containsItem = (node: PanesNode, itemId: string): boolean =>
  node.type === "group" ? node.items.includes(itemId) : containsItem(node.first, itemId) || containsItem(node.second, itemId);

const parseMailComposerPanes = (value: unknown): PanesLayout | null => {
  const layout = parsePanesLayout(value);
  return layout?.root && nodeAllowed(layout.root) && containsItem(layout.root, "editor") ? layout : null;
};

export const normalizeMailComposerPanes = (value: unknown): PanesLayout =>
  parseMailComposerPanes(value) ?? createDefaultMailComposerPanesLayout();

export const readMailComposerPanesFromCookieHeader = (cookieHeader: string | null | undefined): PanesLayout => {
  let layout: PanesLayout | null = null;
  for (const part of (cookieHeader ?? "").split(";")) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0 || trimmed.slice(0, separatorIndex) !== MAIL_COMPOSER_PANES_COOKIE) continue;
    try {
      layout = parseMailComposerPanes(JSON.parse(decodeURIComponent(trimmed.slice(separatorIndex + 1)))) ?? layout;
    } catch {
      // Ignore malformed duplicates and keep the last valid layout.
    }
  }
  return layout ?? createDefaultMailComposerPanesLayout();
};
