/**
 * Prometheus metrics snapshot, catalogue, and scrape tokens.
 */
import { arg, command, confirmFlag, flag } from "../index";
import { parseExpiresAt } from "./notifications";
import { apiGet, apiJson, formatMs, printJsonOrTable, truncate } from "./shared";

export type MetricsToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type MetricsCollector = {
  id: string;
  name: string;
  description: string;
  status: "ok" | "error";
  series: number;
  durationMs: number;
  lastRunAt: string;
  error: string | null;
  metricNames: string[];
};

export const metricsCommands = [
  command("metrics status", {
    summary: "Show metric collector status",
    run: async ({ ctx }) => {
      const result = await apiGet<{ generatedAt: string; series: number; collectors: MetricsCollector[] }>(
        ctx,
        "/api/gateway/metrics/snapshot",
      );
      const rows = result.collectors.map((collector) => ({
        id: collector.id,
        status: collector.status,
        series: collector.series,
        duration: formatMs(collector.durationMs),
        metrics: collector.metricNames.length,
        error: truncate(collector.error, 60),
      }));
      printJsonOrTable(ctx, result, rows, [
        { key: "id" },
        { key: "status" },
        { key: "series" },
        { key: "duration" },
        { key: "metrics" },
        { key: "error" },
      ]);
    },
  }),
  command("metrics read", {
    summary: "Read raw Prometheus metrics",
    run: async ({ ctx }) => {
      const response = await ctx.fetch("/metrics");
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`${response.status} ${text.trim() || response.statusText}`);
      }
      ctx.print((await response.text()).trimEnd());
    },
  }),
  command("metrics catalogue", {
    summary: "List exposed metric names by collector",
    flags: {
      search: flag.string({ aliases: ["q"], description: "Search metric or collector text" }),
      category: flag.string({ description: "Collector id or name filter" }),
    },
    run: async ({ ctx, flags }) => {
      const result = await apiGet<{ generatedAt: string; series: number; collectors: MetricsCollector[] }>(
        ctx,
        "/api/gateway/metrics/snapshot",
      );
      const search = flags.search?.toLowerCase();
      const category = flags.category?.toLowerCase();
      const rows = result.collectors
        .filter((collector) => !category || collector.id.toLowerCase() === category || collector.name.toLowerCase() === category)
        .flatMap((collector) =>
          collector.metricNames.map((metric) => ({
            collector: collector.id,
            name: metric,
            status: collector.status,
            series: collector.series,
            description: truncate(collector.description, 90),
          })),
        )
        .filter((row) => {
          if (!search) return true;
          return `${row.collector} ${row.name} ${row.description}`.toLowerCase().includes(search);
        })
        .sort((a, b) => a.collector.localeCompare(b.collector) || a.name.localeCompare(b.name));
      printJsonOrTable(ctx, { generatedAt: result.generatedAt, items: rows }, rows, [
        { key: "collector" },
        { key: "name" },
        { key: "status" },
        { key: "series" },
        { key: "description" },
      ]);
    },
  }),
  command("metrics tokens list", {
    summary: "List metrics bearer tokens",
    run: async ({ ctx }) => {
      const result = await apiGet<{ items: MetricsToken[] }>(ctx, "/api/gateway/metrics/tokens");
      const rows = result.items.map((token) => ({
        name: token.name,
        prefix: token.tokenPrefix,
        expires: token.expiresAt ?? "never",
        lastUsed: token.lastUsedAt ?? "never",
        id: token.id,
      }));
      printJsonOrTable(ctx, result, rows, [{ key: "name" }, { key: "prefix" }, { key: "expires" }, { key: "lastUsed" }, { key: "id" }]);
    },
  }),
  command("metrics tokens create", {
    summary: "Create a metrics bearer token",
    args: { name: arg.required({ valueLabel: "name" }) },
    flags: { expiresAt: flag.string({ name: "expires-at", description: "ISO expiry timestamp, never, or null" }) },
    run: async ({ ctx, args, flags }) => {
      const result = await apiJson<{ token: string; credential: MetricsToken }>(ctx, "POST", "/api/gateway/metrics/tokens", {
        name: args.name,
        expiresAt: parseExpiresAt(flags.expiresAt) ?? null,
      });
      if (ctx.options.output === "json") ctx.json(result);
      else ctx.print(`Token: ${result.token}\nPrefix: ${result.credential.tokenPrefix}\nStore this token now. It cannot be shown again.`);
    },
  }),
  command("metrics tokens revoke", {
    summary: "Revoke a metrics bearer token",
    args: { id: arg.required({ valueLabel: "id" }) },
    flags: { yes: confirmFlag("Confirm metrics token revocation") },
    run: async ({ ctx, args, flags }) => {
      if (!flags.yes) throw new Error("Refusing to revoke a metrics token without --yes.");
      const result = await apiJson<{ message: string }>(ctx, "DELETE", `/api/gateway/metrics/tokens/${encodeURIComponent(args.id)}`);
      if (ctx.options.output === "json") ctx.json(result);
      else ctx.print(result.message);
    },
  }),
];
