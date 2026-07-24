/**
 * Health webhook configuration and delivery testing.
 */
import { arg, type CloudCliTableColumn, command, confirmFlag, flag } from "../index";
import { apiGet, apiJson, cleanObject, printJsonOrTable, readJsonInput, truncate } from "./shared";

export type HealthWebhook = {
  id: string;
  name: string;
  url: string;
  method: "GET" | "POST";
  enabled: boolean;
  scopeKind: "all" | "include" | "exclude";
  scopeAppIds: string[];
  sendOn: ("ok" | "warn" | "error" | "recovery" | "every_check")[];
  minStatus: "ok" | "warn" | "error";
  repeatIntervalMs: number;
  timeoutMs: number;
  lastStatus: "ok" | "warn" | "error" | null;
  lastSentAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  deliveryCount: number;
  failureCount: number;
};

export const webhookInputFromFlags = (flags: {
  name?: string;
  url?: string;
  method?: "GET" | "POST";
  enabled?: boolean;
  disabled?: boolean;
  scope?: "all" | "include" | "exclude";
  apps?: string;
  sendOn?: string;
  minStatus?: "ok" | "warn" | "error";
  repeatIntervalMs?: number;
  timeoutMs?: number;
}) => ({
  name: flags.name,
  url: flags.url,
  method: flags.method,
  enabled: flags.disabled ? false : flags.enabled ? true : undefined,
  scopeKind: flags.scope,
  scopeAppIds: flags.apps
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  sendOn: flags.sendOn
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  minStatus: flags.minStatus,
  repeatIntervalMs: flags.repeatIntervalMs,
  timeoutMs: flags.timeoutMs,
});

export const defaultWebhookInput = (flags: ReturnType<typeof webhookInputFromFlags>) => ({
  name: flags.name,
  url: flags.url,
  method: flags.method ?? "POST",
  enabled: flags.enabled ?? true,
  scopeKind: flags.scopeKind ?? "all",
  scopeAppIds: flags.scopeAppIds ?? [],
  sendOn: flags.sendOn ?? ["error", "recovery"],
  minStatus: flags.minStatus ?? "error",
  repeatIntervalMs: flags.repeatIntervalMs ?? 1_800_000,
  timeoutMs: flags.timeoutMs ?? 5000,
});

export const webhookRows = (items: HealthWebhook[]) =>
  items.map((webhook) => ({
    enabled: webhook.enabled,
    name: webhook.name,
    method: webhook.method,
    status: webhook.lastStatus ?? "",
    failures: webhook.failureCount,
    scope: webhook.scopeKind,
    sendOn: webhook.sendOn.join(","),
    url: truncate(webhook.url, 72),
    id: webhook.id,
  }));

export const webhookColumns = [
  { key: "enabled" },
  { key: "name" },
  { key: "method" },
  { key: "status" },
  { key: "failures" },
  { key: "scope" },
  { key: "sendOn" },
  { key: "url" },
  { key: "id" },
] satisfies CloudCliTableColumn<ReturnType<typeof webhookRows>[number]>[];

export const webhookCommands = [
  command("webhooks list", {
    summary: "List gateway health webhooks",
    run: async ({ ctx }) => {
      const result = await apiGet<HealthWebhook[]>(ctx, "/api/gateway/health/webhooks");
      printJsonOrTable(ctx, result, webhookRows(result), webhookColumns);
    },
  }),
  command("webhooks get", {
    summary: "Show one gateway health webhook",
    args: { id: arg.required({ valueLabel: "id" }) },
    run: async ({ ctx, args }) => {
      const result = await apiGet<HealthWebhook[]>(ctx, "/api/gateway/health/webhooks");
      const webhook = result.find((item) => item.id === args.id);
      if (!webhook) throw new Error("Health webhook not found.");
      printJsonOrTable(ctx, webhook, webhookRows([webhook]), webhookColumns);
    },
  }),
  command("webhooks apply", {
    summary: "Create or replace a gateway health webhook from JSON",
    args: { id: arg.optional({ valueLabel: "id" }) },
    flags: {
      body: flag.input({
        name: "body",
        fileName: "body-file",
        fileAliases: ["f"],
        required: true,
        description: "Webhook JSON body",
      }),
    },
    run: async ({ ctx, args, flags }) => {
      const payload = await readJsonInput<unknown>(flags.body, "webhook");
      const path = args.id ? `/api/gateway/health/webhooks/${encodeURIComponent(args.id)}` : "/api/gateway/health/webhooks";
      const result = await apiJson<HealthWebhook>(ctx, args.id ? "PUT" : "POST", path, payload);
      if (ctx.options.output === "json") ctx.json(result);
      else ctx.print(`${args.id ? "Updated" : "Created"} webhook ${result.name}.`);
    },
  }),
  command("webhooks create", {
    summary: "Create a gateway health webhook from flags",
    flags: {
      name: flag.string({ required: true, description: "Webhook name" }),
      url: flag.string({ required: true, description: "Webhook URL" }),
      method: flag.enum(["GET", "POST"], { default: "POST", description: "HTTP method" }),
      enabled: flag.boolean({ default: true, description: "Enable webhook" }),
      disabled: flag.boolean({ description: "Create disabled" }),
      scope: flag.enum(["all", "include", "exclude"], { default: "all", description: "App scope mode" }),
      apps: flag.string({ description: "Comma-separated app ids for include/exclude scope" }),
      sendOn: flag.string({ name: "send-on", description: "Comma-separated events: ok,warn,error,recovery,every_check" }),
      minStatus: flag.enum(["ok", "warn", "error"], { name: "min-status", default: "error", description: "Minimum status" }),
      repeatIntervalMs: flag.int({ name: "repeat-interval-ms", description: "Repeat interval in milliseconds" }),
      timeoutMs: flag.int({ name: "timeout-ms", description: "Request timeout in milliseconds" }),
    },
    run: async ({ ctx, flags }) => {
      const input = defaultWebhookInput(webhookInputFromFlags(flags));
      const result = await apiJson<HealthWebhook>(ctx, "POST", "/api/gateway/health/webhooks", input);
      if (ctx.options.output === "json") ctx.json(result);
      else ctx.print(`Created webhook ${result.name}.`);
    },
  }),
  command("webhooks update", {
    summary: "Partially update a gateway health webhook from flags",
    args: { id: arg.required({ valueLabel: "id" }) },
    flags: {
      name: flag.string({ description: "Webhook name" }),
      url: flag.string({ description: "Webhook URL" }),
      method: flag.enum(["GET", "POST"], { description: "HTTP method" }),
      enabled: flag.boolean({ description: "Enable webhook" }),
      disabled: flag.boolean({ description: "Disable webhook" }),
      scope: flag.enum(["all", "include", "exclude"], { description: "App scope mode" }),
      apps: flag.string({ description: "Comma-separated app ids for include/exclude scope" }),
      sendOn: flag.string({ name: "send-on", description: "Comma-separated events: ok,warn,error,recovery,every_check" }),
      minStatus: flag.enum(["ok", "warn", "error"], { name: "min-status", description: "Minimum status" }),
      repeatIntervalMs: flag.int({ name: "repeat-interval-ms", description: "Repeat interval in milliseconds" }),
      timeoutMs: flag.int({ name: "timeout-ms", description: "Request timeout in milliseconds" }),
    },
    run: async ({ ctx, args, flags }) => {
      const items = await apiGet<HealthWebhook[]>(ctx, "/api/gateway/health/webhooks");
      const current = items.find((item) => item.id === args.id);
      if (!current) throw new Error("Health webhook not found.");
      const update = cleanObject(webhookInputFromFlags(flags));
      const input = {
        name: current.name,
        url: current.url,
        method: current.method,
        enabled: current.enabled,
        scopeKind: current.scopeKind,
        scopeAppIds: current.scopeAppIds,
        sendOn: current.sendOn,
        minStatus: current.minStatus,
        repeatIntervalMs: current.repeatIntervalMs,
        timeoutMs: current.timeoutMs,
        ...update,
      };
      const result = await apiJson<HealthWebhook>(ctx, "PUT", `/api/gateway/health/webhooks/${encodeURIComponent(args.id)}`, input);
      if (ctx.options.output === "json") ctx.json(result);
      else ctx.print(`Updated webhook ${result.name}.`);
    },
  }),
  command("webhooks test", {
    summary: "Submit a gateway health webhook test delivery",
    args: { id: arg.required({ valueLabel: "id" }) },
    flags: { yes: confirmFlag("Confirm sending a webhook test delivery") },
    run: async ({ ctx, args, flags }) => {
      if (!flags.yes) throw new Error("Refusing to test a webhook without --yes.");
      const result = await apiJson<{ message: string; jobId: string }>(
        ctx,
        "POST",
        `/api/gateway/health/webhooks/${encodeURIComponent(args.id)}/test`,
      );
      if (ctx.options.output === "json") ctx.json(result);
      else ctx.print(`${result.message}: ${result.jobId}`);
    },
  }),
  command("webhooks delete", {
    summary: "Delete a gateway health webhook",
    args: { id: arg.required({ valueLabel: "id" }) },
    flags: { yes: confirmFlag("Confirm webhook deletion") },
    run: async ({ ctx, args, flags }) => {
      if (!flags.yes) throw new Error("Refusing to delete a webhook without --yes.");
      const result = await apiJson<{ message: string }>(ctx, "DELETE", `/api/gateway/health/webhooks/${encodeURIComponent(args.id)}`);
      if (ctx.options.output === "json") ctx.json(result);
      else ctx.print(result.message);
    },
  }),
];
