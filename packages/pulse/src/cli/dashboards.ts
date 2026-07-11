import { arg, type CloudCliContext, command, confirmFlag, flag, readCliInput } from "@valentinkolb/cloud/cli";
import type { PulseDashboard, PulseDashboardConfig, PulseDashboardDslCompileResult } from "../contracts";
import { listDashboards, requireRestArg, resolveBaseFromCommand, resolveDashboard } from "./context";
import { baseFlag, DASHBOARD_DSL_INPUT, publicDisplayFlags } from "./flags";
import { dashboardRows } from "./rows";
import { jsonRequest, printJsonOrTable, printMessage, readApi, readTextInput, yesNo } from "./shared";
import type { MessageResult } from "./types";

type DashboardPublishResult = { dashboard: PulseDashboard; token: string };

const publicDashboardDisplayUrl = (ctx: CloudCliContext, token: string, options: { theme?: string; height?: string } = {}): string => {
  const url = new URL(`/app/pulse/display/${encodeURIComponent(token)}`, ctx.options.server);
  if (options.theme === "light" || options.theme === "dark") url.searchParams.set("theme", options.theme);
  if (options.height === "scroll" || options.height === "full") url.searchParams.set("height", options.height);
  return url.toString();
};

const compileDashboardDsl = async (ctx: CloudCliContext, baseId: string, text: string): Promise<PulseDashboardConfig> => {
  const result = await readApi<PulseDashboardDslCompileResult>(ctx, "/dashboard-dsl/compile", jsonRequest("POST", { baseId, text }));
  if (!result.ok || !result.config) {
    const diagnostics = result.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`).join("\n");
    throw new Error(`Dashboard DSL is invalid.${diagnostics ? `\n${diagnostics}` : ""}`);
  }
  return { ...result.config, dsl: text };
};

export const dashboardCommands = [
  command("dashboards list", {
    summary: "List dashboards",
    flags: baseFlag,
    args: { args: arg.rest({ valueLabel: "base" }) },
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const dashboards = await listDashboards(ctx, base.id);
      printJsonOrTable(ctx, dashboards, dashboardRows(dashboards), [
        { key: "id" },
        { key: "name" },
        { key: "public" },
        { key: "dsl" },
        { key: "refresh" },
        { key: "updatedAt" },
      ]);
    },
  }),
  command("dashboards get", {
    summary: "Show a dashboard",
    flags: baseFlag,
    args: { args: arg.rest({ valueLabel: "base dashboard", required: true }) },
    async run({ ctx, args }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
      const dashboard = await resolveDashboard(ctx, base.id, requireRestArg(rest, 0, "dashboard"));
      if (ctx.options.output === "json") ctx.json(dashboard);
      else {
        ctx.print(`${dashboard.name} (${dashboard.id})`);
        ctx.print(`Public: ${yesNo(dashboard.publicEnabled)}`);
        ctx.print(`Refresh: ${dashboard.config.refreshIntervalSeconds ?? "manual"}`);
        if (dashboard.config.dsl) ctx.print(dashboard.config.dsl);
      }
    },
  }),
  command("dashboards compile", {
    summary: "Compile dashboard DSL",
    flags: { ...baseFlag, content: DASHBOARD_DSL_INPUT },
    args: { args: arg.rest({ valueLabel: "base" }) },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const text = await readTextInput(flags.content, "dashboard DSL", 40000);
      const result = await readApi<PulseDashboardDslCompileResult>(
        ctx,
        "/dashboard-dsl/compile",
        jsonRequest("POST", { baseId: base.id, text }),
      );
      if (ctx.options.output === "json") ctx.json(result);
      else if (result.ok) ctx.print("Dashboard DSL is valid.");
      else {
        for (const diagnostic of result.diagnostics) ctx.print(`${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`);
      }
    },
  }),
  command("dashboards create", {
    summary: "Create a dashboard from DSL",
    flags: {
      ...baseFlag,
      name: flag.string({ required: true, description: "Dashboard name" }),
      content: DASHBOARD_DSL_INPUT,
      public: flag.boolean({ description: "Enable public link after create" }),
      ...publicDisplayFlags,
    },
    args: { args: arg.rest({ valueLabel: "base" }) },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const text = await readTextInput(flags.content, "dashboard DSL", 40000);
      const compiled = await compileDashboardDsl(ctx, base.id, text);
      const config = {
        dsl: text,
        refreshIntervalSeconds: compiled.refreshIntervalSeconds,
      };
      const dashboard = await readApi<PulseDashboard>(
        ctx,
        `/bases/${encodeURIComponent(base.id)}/dashboards`,
        jsonRequest("POST", { name: flags.name, config }),
      );
      if (!flags.public) {
        if (ctx.options.output === "json") ctx.json(dashboard);
        else ctx.print(`Created dashboard ${dashboard.name} (${dashboard.id}).`);
        return;
      }
      const result = await readApi<DashboardPublishResult>(
        ctx,
        `/dashboards/${encodeURIComponent(dashboard.id)}/public-token`,
        jsonRequest("POST"),
      );
      const url = publicDashboardDisplayUrl(ctx, result.token, flags);
      if (ctx.options.output === "json") ctx.json({ ...result, url });
      else {
        ctx.print(`Created dashboard ${result.dashboard.name} (${result.dashboard.id}).`);
        ctx.print(`Public token: ${result.token}`);
        ctx.print(`Public URL: ${url}`);
      }
    },
  }),
  command("dashboards update", {
    summary: "Update dashboard metadata or DSL",
    flags: {
      ...baseFlag,
      name: flag.string({ description: "Dashboard name" }),
      content: DASHBOARD_DSL_INPUT,
    },
    args: { args: arg.rest({ valueLabel: "base dashboard", required: true }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
      const dashboard = await resolveDashboard(ctx, base.id, requireRestArg(rest, 0, "dashboard"));
      const text = await readCliInput(flags.content, { label: "dashboard DSL", required: false, trimFinalNewline: true });
      const trimmedText = text?.trim();
      const compiled = trimmedText ? await compileDashboardDsl(ctx, base.id, trimmedText) : undefined;
      const config = compiled
        ? {
            dsl: trimmedText!,
            refreshIntervalSeconds: compiled.refreshIntervalSeconds,
          }
        : undefined;
      const updated = await readApi<PulseDashboard>(
        ctx,
        `/dashboards/${encodeURIComponent(dashboard.id)}`,
        jsonRequest("PATCH", { name: flags.name, config }),
      );
      if (ctx.options.output === "json") ctx.json(updated);
      else ctx.print(`Updated dashboard ${updated.name} (${updated.id}).`);
    },
  }),
  command("dashboards delete", {
    summary: "Delete a dashboard",
    flags: { ...baseFlag, yes: confirmFlag("Delete this dashboard") },
    args: { args: arg.rest({ valueLabel: "base dashboard", required: true }) },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Refusing to delete without --yes.");
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
      const dashboard = await resolveDashboard(ctx, base.id, requireRestArg(rest, 0, "dashboard"));
      const result = await readApi<MessageResult>(ctx, `/dashboards/${encodeURIComponent(dashboard.id)}`, jsonRequest("DELETE"));
      printMessage(ctx, result, result.message);
    },
  }),
  command("dashboards publish", {
    summary: "Enable a dashboard public link",
    flags: { ...baseFlag, ...publicDisplayFlags },
    args: { args: arg.rest({ valueLabel: "base dashboard", required: true }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
      const dashboard = await resolveDashboard(ctx, base.id, requireRestArg(rest, 0, "dashboard"));
      const result = await readApi<DashboardPublishResult>(
        ctx,
        `/dashboards/${encodeURIComponent(dashboard.id)}/public-token`,
        jsonRequest("POST"),
      );
      const url = publicDashboardDisplayUrl(ctx, result.token, flags);
      if (ctx.options.output === "json") ctx.json({ ...result, url });
      else {
        ctx.print(`Published dashboard ${result.dashboard.name}.`);
        ctx.print(`Public token: ${result.token}`);
        ctx.print(`Public URL: ${url}`);
      }
    },
  }),
  command("dashboards public-url", {
    summary: "Create or show a dashboard public display URL",
    flags: {
      ...baseFlag,
      ...publicDisplayFlags,
      yes: confirmFlag("Enable or show this dashboard public link"),
    },
    args: { args: arg.rest({ valueLabel: "base dashboard", required: true }) },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Refusing to enable or show a public link without --yes.");
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
      const dashboard = await resolveDashboard(ctx, base.id, requireRestArg(rest, 0, "dashboard"));
      const result = await readApi<DashboardPublishResult>(
        ctx,
        `/dashboards/${encodeURIComponent(dashboard.id)}/public-token`,
        jsonRequest("POST"),
      );
      const url = publicDashboardDisplayUrl(ctx, result.token, flags);
      if (ctx.options.output === "json") ctx.json({ ...result, url });
      else ctx.print(url);
    },
  }),
  command("dashboards unpublish", {
    summary: "Disable a dashboard public link",
    flags: baseFlag,
    args: { args: arg.rest({ valueLabel: "base dashboard", required: true }) },
    async run({ ctx, args }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, 1);
      const dashboard = await resolveDashboard(ctx, base.id, requireRestArg(rest, 0, "dashboard"));
      const updated = await readApi<PulseDashboard>(
        ctx,
        `/dashboards/${encodeURIComponent(dashboard.id)}/public-token`,
        jsonRequest("DELETE"),
      );
      if (ctx.options.output === "json") ctx.json(updated);
      else ctx.print(`Unpublished dashboard ${updated.name}.`);
    },
  }),
];
