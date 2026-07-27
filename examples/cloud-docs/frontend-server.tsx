import { createUrlFilter, oneOf, page, text } from "@valentinkolb/cloud/ssr";
import { StatusBadge } from "@valentinkolb/cloud/ui";
import { Hono } from "hono";

export const inventoryRoutes = new Hono().get("/items/:id", (c) => c.json({ id: c.req.param("id"), name: "Example" }));

export type InventoryApi = typeof inventoryRoutes;

export const inventoryFilter = createUrlFilter("/app/inventory", {
  search: text("search"),
  status: oneOf("status", ["all", "low", "out"] as const, "all"),
  page: page(),
});

export const InventoryStatus = () => <StatusBadge tone="ok" label="Available" />;
