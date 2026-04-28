import type { RouteTable } from "./trie";
import type { ProxyStats } from "./proxy";
import { buildRouteTable } from "./trie";
import { createProxyStats } from "./proxy";

// ─── Shared mutable state (read by admin page, written by proxy) ─────────────

let currentTable: RouteTable = buildRouteTable([]);
let stats: ProxyStats = createProxyStats();

export const getRouteTable = (): RouteTable => currentTable;
export const setRouteTable = (table: RouteTable): void => {
  currentTable = table;
};

export const getGatewayStats = (): ProxyStats => stats;
export const resetStats = (): void => {
  stats = createProxyStats();
};

export { stats };
