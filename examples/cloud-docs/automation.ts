import { workflowAction, workflowEvent } from "@valentinkolb/cloud/workflows";
import { createWorkflowActionPort, emitWorkflowEvent } from "@valentinkolb/cloud/workflows/store";
import {
  ephemeral,
  expBackoff,
  isRetryableTransportError,
  job,
  mutex,
  queue,
  ratelimit,
  retry,
  scheduler,
  topic,
} from "@valentinkolb/sync";

export const inventoryJobs = job<{ itemId: string }>({
  id: "inventory.reindex",
  process: async ({ ctx }) => ({ itemId: ctx.input.itemId }),
  after: ({ ctx }) => {
    if (ctx.error && ctx.failureCount < 3) {
      ctx.reschedule({ delayMs: ctx.expBackoff() });
    }
  },
});

export const fetchInventoryWithRetry = (signal: AbortSignal) =>
  retry({
    run: () => fetch("https://inventory.example.com/items", { signal }),
    after: ({ ctx }) => {
      if (ctx.error && ctx.attempt < 3 && isRetryableTransportError(ctx.error)) {
        ctx.reschedule({ delayMs: ctx.expBackoff() });
      }
    },
    signal,
  });

export const nextRetryDelay = (attempt: number) => expBackoff(attempt, { baseMs: 500, maxMs: 30_000 });

export const inventoryQueue = queue<{ itemId: string }>({
  id: "inventory.imports",
});

export const inventoryTopic = topic<{ itemId: string }>({
  id: "inventory.events",
});

export const inventoryPresence = ephemeral<{ userId: string }>({
  id: "inventory.editors",
  ttlMs: 30_000,
});

export const inventoryMutex = mutex({
  id: "inventory.stock",
  defaultTtl: 10_000,
});

export const inventoryRateLimit = ratelimit({
  id: "inventory.exports",
  limit: 10,
  windowSecs: 60,
});

export const inventoryScheduler = scheduler({ id: "inventory" });

export const INVENTORY_EVENTS = {
  itemChanged: workflowEvent({
    label: "Item changed",
    description: "An inventory item changed.",
    data: {
      kind: "object",
      properties: { itemId: { kind: "string" } },
    },
  }),
};

export const INVENTORY_ACTIONS = {
  loadItem: workflowAction.pure({
    label: "Load item",
    description: "Loads an inventory item.",
    config: {
      kind: "object",
      properties: { itemId: { kind: "string" } },
    },
    run: async (_ctx, config) => ({
      state: "succeeded",
      output: { itemId: config.itemId },
    }),
  }),
};

export const inventoryWorkflowActions = createWorkflowActionPort(INVENTORY_ACTIONS);

export const emitItemChanged = (warehouseId: string, itemId: string, version: number) =>
  emitWorkflowEvent({
    appId: "inventory",
    scopeId: warehouseId,
    type: "inventory.itemChanged",
    data: { itemId },
    dedupeKey: `item:${itemId}:${version}`,
  });
