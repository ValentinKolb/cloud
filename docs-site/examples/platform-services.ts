import { defineApp, notification } from "@valentinkolb/cloud";
import { logger, notifications } from "@valentinkolb/cloud/services";
import type { AppContext } from "@valentinkolb/cloud/server";
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

export const app = defineApp({
  id: "inventory",
  name: "Inventory",
  icon: "ti ti-packages",
  description: "Track stock and warehouse movements.",
  baseUrl: "http://app-inventory:3000",
  routes: ["/api/inventory", "/app/inventory"],
  settings: {
    "inventory.low_stock_threshold": {
      kind: "number",
      label: "Low-stock threshold",
      description: "Warn when available stock falls below this number.",
      default: 5,
      min: 0,
    },
  },
  notifications: INVENTORY_NOTIFICATIONS,
});

const log = logger("inventory:stock");

type InventorySettings = AppContext<typeof app>["Variables"]["settings"];

export const readThreshold = (settings: InventorySettings): number => {
  const threshold = settings.inventory.low_stock_threshold;
  log.debug("Inventory configuration read", { threshold });
  return threshold;
};

export const updateThreshold = (threshold: number): Promise<void> =>
  app.settings.set("inventory.low_stock_threshold", threshold);

export const notifyLowStock = (input: {
  ownerId: string;
  itemId: string;
  itemName: string;
  remaining: number;
  thresholdVersion: number;
}) =>
  notifications.send(app.notifications.stockLow, {
    recipient: { userId: input.ownerId },
    data: {
      itemId: input.itemId,
      itemName: input.itemName,
      remaining: input.remaining,
    },
    idempotencyKey: `stock-low:${input.itemId}:${input.thresholdVersion}`,
  });
