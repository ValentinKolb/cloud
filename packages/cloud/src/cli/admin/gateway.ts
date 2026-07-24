/**
 * Gateway surface: the registry of running apps and the route table.
 */
import { arg, type CloudCliContext, command, confirmFlag, flag } from "../index";
import { apiGet, apiJson, printJsonOrTable, queryString } from "./shared";

export type GatewayHealth = {
  status: "ok" | "warn" | "error";
  checkedAt: string;
  summary: Record<string, number>;
  apps: {
    id: string;
    name: string;
    status: "ok" | "warn" | "error";
    online: boolean;
    healthy: boolean;
    lastSeenAt: string;
    offlineForMs: number;
  }[];
};

export type GatewayRoute = {
  prefix: string;
  appId: string;
  count: number;
  errors: number;
  lastSeen: string | null;
};

export type GatewayRoutesResponse = {
  generatedAt: string | null;
  instanceId: string | null;
  total: number;
  routeCount: number;
  items: GatewayRoute[];
};

export const resolveApp = async (ctx: CloudCliContext, ref: string) => {
  const health = await apiGet<GatewayHealth>(ctx, "/api/gateway/health");
  const lower = ref.toLowerCase();
  const matches = health.apps.filter((app) => app.id.toLowerCase() === lower || app.name.toLowerCase() === lower);
  if (matches.length === 1) return { health, app: matches[0]! };
  if (matches.length > 1) throw new Error(`Ambiguous app reference "${ref}". Use an app id.`);
  throw new Error(`App "${ref}" not found.`);
};

export const gatewayCommands = [
  command("apps list", {
    summary: "List registered apps and live health",
    run: async ({ ctx }) => {
      const health = await apiGet<GatewayHealth>(ctx, "/api/gateway/health");
      const rows = health.apps.map((app) => ({
        id: app.id,
        name: app.name,
        status: app.status,
        online: app.online,
        healthy: app.healthy,
        lastSeen: app.lastSeenAt,
        offlineMs: app.offlineForMs,
      }));
      printJsonOrTable(ctx, health, rows, [
        { key: "id" },
        { key: "status" },
        { key: "online" },
        { key: "healthy" },
        { key: "lastSeen" },
        { key: "name" },
      ]);
    },
  }),
  command("apps get", {
    summary: "Show one registered app by id or exact name",
    args: { ref: arg.required({ valueLabel: "id|name" }) },
    run: async ({ ctx, args }) => {
      const { app } = await resolveApp(ctx, args.ref);
      printJsonOrTable(
        ctx,
        app,
        [
          {
            id: app.id,
            name: app.name,
            status: app.status,
            online: app.online,
            healthy: app.healthy,
            lastSeen: app.lastSeenAt,
            offlineMs: app.offlineForMs,
          },
        ],
        [
          { key: "id" },
          { key: "name" },
          { key: "status" },
          { key: "online" },
          { key: "healthy" },
          { key: "lastSeen" },
          { key: "offlineMs" },
        ],
      );
    },
  }),
  command("apps remove", {
    summary: "Remove an offline registered app",
    args: { id: arg.required({ valueLabel: "app-id" }) },
    flags: { yes: confirmFlag("Confirm removing the offline app registry entry") },
    run: async ({ ctx, args, flags }) => {
      if (!flags.yes) throw new Error("Refusing to remove an app without --yes.");
      const result = await apiJson<{ id: string }>(ctx, "DELETE", `/api/gateway/apps/${encodeURIComponent(args.id)}`);
      if (ctx.options.output === "json") ctx.json(result);
      else ctx.print(`Removed ${result.id}.`);
    },
  }),
  command("routes list", {
    summary: "List active gateway routes",
    flags: {
      search: flag.string({ aliases: ["q"], description: "Search route prefix or app id" }),
      app: flag.string({ description: "Filter by app id" }),
      errors: flag.boolean({ description: "Only routes with errors" }),
      sort: flag.enum(["count", "prefix", "errors"], { default: "count", description: "Sort by count, prefix, or errors" }),
    },
    run: async ({ ctx, flags }) => {
      const result = await apiGet<GatewayRoutesResponse>(
        ctx,
        `/api/gateway/routes${queryString({
          search: flags.search,
          app: flags.app,
          errors: flags.errors,
          sort: flags.sort,
        })}`,
      );
      const rows = result.items.map((route) => ({
        prefix: route.prefix,
        app: route.appId,
        requests: route.count,
        errors: route.errors,
        lastSeen: route.lastSeen ?? "",
      }));
      printJsonOrTable(ctx, result, rows, [{ key: "prefix" }, { key: "app" }, { key: "requests" }, { key: "errors" }, { key: "lastSeen" }]);
    },
  }),
];
