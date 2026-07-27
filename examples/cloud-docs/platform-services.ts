import { defineApp, notification } from "@valentinkolb/cloud";
import type { AppSearchInput, AppSearchResult, WidgetResponse } from "@valentinkolb/cloud/contracts";
import type { AppContext } from "@valentinkolb/cloud/server";
import { audit, logger, notifications, renderHtmlToPdf, trace } from "@valentinkolb/cloud/services";
import { z } from "zod";

const INVENTORY_NOTIFICATIONS = {
  stockLow: notification({
    recipient: "user",
    label: "Low stock",
    description: "Warns inventory owners when an item falls below its threshold.",
    delivery: { recommended: ["browser", "email"] },
    data: z.object({
      itemId: z.string(),
      itemName: z.string(),
      remaining: z.number().int().nonnegative(),
    }),
    render: ({ itemId, itemName, remaining }) => ({
      title: `${itemName} is running low`,
      body: `${remaining} units remain.`,
      targetHref: `/app/inventory/items/${encodeURIComponent(itemId)}`,
    }),
    email: ({ itemName, remaining }) => ({
      subject: `${itemName} is running low`,
      content: `${remaining} units remain.`,
    }),
  }),
};

export const platformApp = defineApp({
  id: "inventory",
  name: "Inventory",
  icon: "ti ti-package",
  description: "Track stock and warehouse movements.",
  baseUrl: "http://app-inventory:3000",
  routes: ["/api/inventory", "/app/inventory"],
  settings: {
    "inventory.low_stock_threshold": {
      kind: "number",
      default: 5,
      min: 0,
    },
  },
  notifications: INVENTORY_NOTIFICATIONS,
  widgets: [
    {
      id: "stock",
      path: "/api/inventory/widget/stock",
      presentation: { defaultZone: "overview" },
    },
  ],
});

export const stockLog = logger("inventory:stock");

type InventorySettings = AppContext<typeof platformApp>["Variables"]["settings"];

export const readThreshold = (settings: InventorySettings): number => {
  const threshold = settings.inventory.low_stock_threshold;
  stockLog.debug("Inventory configuration read", { threshold });
  return threshold;
};

export const updateThreshold = (threshold: number): Promise<void> => platformApp.settings.set("inventory.low_stock_threshold", threshold);

export const notifyLowStock = (input: { ownerId: string; itemId: string; itemName: string; remaining: number; thresholdVersion: number }) =>
  notifications.send(platformApp.notifications.stockLow, {
    recipient: { userId: input.ownerId },
    data: {
      itemId: input.itemId,
      itemName: input.itemName,
      remaining: input.remaining,
    },
    idempotencyKey: `stock-low:${input.itemId}:${input.thresholdVersion}`,
  });

export const traceImport = async (fileId: string): Promise<void> => {
  await trace.withSpan(
    {
      name: "inventory.import",
      source: "inventory:import",
      appId: "inventory",
      category: "job",
      attributes: { "inventory.file_id": fileId },
    },
    async (span) => {
      await trace.record({
        context: span,
        event: "inventory.import.validated",
      });
    },
  );
};

export const recordPermissionChange = async (actorId: string, itemId: string): Promise<void> => {
  await audit.record({
    action: "inventory.item.permission.update",
    outcome: "allowed",
    actor: { userId: actorId },
    target: { type: "inventory_item", id: itemId },
  });
};

type SearchableInventoryItem = {
  id: string;
  name: string;
  quantity: number;
};

type InventorySearchRepository = {
  search(input: { query: string; limit: number; accessSubject: AppSearchInput["accessSubject"] }): Promise<SearchableInventoryItem[]>;
};

export const createInventorySearch =
  (repository: InventorySearchRepository) =>
  async (input: AppSearchInput): Promise<AppSearchResult[]> => {
    const items = await repository.search({
      query: input.query,
      limit: input.limit,
      accessSubject: input.accessSubject,
    });

    return items.map((item) => ({
      id: item.id,
      title: item.name,
      href: `/app/inventory/items/${item.id}`,
      preview: `${item.quantity} in stock`,
    }));
  };

export const inventoryWidget = (count: number): WidgetResponse => ({
  title: "Inventory",
  blocks: [{ kind: "stat", value: count, label: "Low-stock items" }],
});

export const renderReport = async (): Promise<Uint8Array> => (await renderHtmlToPdf({ html: "<h1>Stock report</h1>" })).pdf;
