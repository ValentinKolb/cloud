import { api } from "@valentinkolb/cloud/browser";
import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { mutation } from "@k2b/stdlib/solid";
import type { InventoryApi } from "./frontend-server";

export const inventoryClient = api.create<InventoryApi>({
  baseUrl: "/api/inventory",
});

export const createItemLoader = () =>
  mutation.create({
    mutation: async (id: string, { abortSignal }) => {
      const response = await inventoryClient.items[":id"].$get({ param: { id } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error("Item could not be loaded");
      return response.json();
    },
  });

export const createInventoryLiveConnection = () =>
  createLiveWebSocket<{ cursor: string }>({
    url: "/api/inventory/ws",
    subscribe: (cursor) => ({ type: "subscribe", cursor }),
    parse: (raw) => JSON.parse(raw) as { cursor: string },
    onMessage: (message, controls) => {
      controls.markApplied(message.cursor);
    },
  });
