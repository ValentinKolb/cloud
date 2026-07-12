import { arg, command, confirmFlag, flag } from "@valentinkolb/cloud/cli";
import type { Dashboard, WorkflowRun } from "../contracts";
import {
  dashboardFlag,
  dashboardRows,
  type Form,
  formFlag,
  formRows,
  listDashboards,
  listForms,
  resolveDashboard,
  resolveDashboardFromCommand,
  resolveFormFromCommand,
} from "./forms-dashboards-support";
import { baseArgs, baseFlag, resolveBaseFromCommand, resolveTable, tableArgs, tableFlag } from "./resources";
import {
  applyDefined,
  JSON_BODY_INPUT,
  jsonRequest,
  type MessageResponse,
  printJsonOrMessage,
  printJsonOrTable,
  readApi,
  readJsonInput,
  requireRestArg,
} from "./runtime";

export const formCommands = [
  command("forms list", {
    summary: "List custom forms for a table",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const forms = await listForms(ctx, table.id);
      printJsonOrTable(ctx, forms, formRows(forms), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "active", label: "ACTIVE" },
        { key: "public", label: "PUBLIC" },
        { key: "fields", label: "FIELDS" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("forms default", {
    summary: "Show the virtual default form for a table",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const form = await readApi<Form>(ctx, `/forms/by-table/${encodeURIComponent(table.id)}/default`);
      if (ctx.options.output === "json") ctx.json(form);
      else {
        ctx.print(`${form.name} (${form.shortId || "default"})`);
        ctx.print(`active: ${form.isActive ? "yes" : "no"}`);
        ctx.print(`id: ${form.id}`);
      }
    },
  }),
  command("forms get", {
    summary: "Show a form",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, ...formFlag },
    async run({ ctx, args, flags }) {
      const { form } = await resolveFormFromCommand(ctx, args.args, flags);
      if (ctx.options.output === "json") ctx.json(form);
      else {
        ctx.print(`${form.name} (${form.shortId || "default"})`);
        ctx.print(`active: ${form.isActive ? "yes" : "no"}`);
        ctx.print(`public: ${form.publicToken ? "yes" : "no"}`);
        ctx.print(`id: ${form.id}`);
      }
    },
  }),
  command("forms create", {
    summary: "Create a custom form",
    description:
      "Form config fields use field UUIDs. Run `cld grids fields list <base> <table>` and `cld grids records shape <base> <table>` first.",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Form name" }),
      config: flag.string({ description: "Form config JSON object" }),
      public: flag.boolean({ description: "Create with a public submit token" }),
      private: flag.boolean({ description: "Create without a public submit token" }),
    },
    examples: [
      'cld grids forms create Bookshop Orders --name \'Checkout\' --config \'{"fields":[{"kind":"user_input","fieldId":"<field-uuid>"}]}\'',
      "cld grids forms create --base Bookshop --table Orders --body-file form.json",
    ],
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "form JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        config: flags.config ? JSON.parse(flags.config) : undefined,
        isPublic: flags.public ? true : flags.private ? false : undefined,
      });
      if (!body.name) throw new Error("Missing form name. Pass --name or --body JSON.");
      const form = await readApi<Form>(ctx, `/forms/by-table/${encodeURIComponent(table.id)}`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, form, `Created form ${form.name} (${form.shortId}).`);
    },
  }),
  command("forms update", {
    summary: "Update a form",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...formFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Form name" }),
      config: flag.string({ description: "Form config JSON object" }),
      public: flag.boolean({ description: "Ensure the form has a public submit token" }),
      private: flag.boolean({ description: "Remove the public submit token" }),
      active: flag.boolean({ description: "Activate the form" }),
      inactive: flag.boolean({ description: "Deactivate the form" }),
      position: flag.int({ min: 0, description: "Form position" }),
    },
    async run({ ctx, args, flags }) {
      const { form } = await resolveFormFromCommand(ctx, args.args, flags);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "form update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        config: flags.config ? JSON.parse(flags.config) : undefined,
        isPublic: flags.public ? true : flags.private ? false : undefined,
        isActive: flags.active ? true : flags.inactive ? false : undefined,
        position: flags.position,
      });
      const updated = await readApi<Form>(ctx, `/forms/${encodeURIComponent(form.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated form ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("forms delete", {
    summary: "Delete a form",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, ...formFlag, yes: confirmFlag("Delete this form") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { form } = await resolveFormFromCommand(ctx, args.args, flags);
      await readApi<MessageResponse>(ctx, `/forms/${encodeURIComponent(form.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: form.id }, `Deleted form ${form.name} (${form.shortId}).`);
    },
  }),
  command("forms restore", {
    summary: "Restore a deleted form by UUID",
    args: { form: arg.required({ description: "Form UUID" }) },
    async run({ ctx, args }) {
      const form = await readApi<Form>(ctx, `/forms/${encodeURIComponent(args.form)}/restore`, jsonRequest("POST"));
      printJsonOrMessage(ctx, form, `Restored form ${form.name} (${form.shortId}).`);
    },
  }),
  command("forms submit", {
    summary: "Submit a form",
    description: "Pass the same JSON payload the form UI submits. User-input keys are field UUIDs.",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, ...formFlag, body: JSON_BODY_INPUT },
    examples: [
      'cld grids forms submit Bookshop Orders Checkout --body \'{"<field-uuid>":"Ada"}\'',
      "cld grids forms submit --base Bookshop --table Orders --form Checkout --body-file submission.json",
    ],
    async run({ ctx, args, flags }) {
      const { form } = await resolveFormFromCommand(ctx, args.args, flags);
      const body = await readJsonInput<Record<string, unknown>>(flags.body, "form submission JSON", true);
      const result = await readApi<{ recordId: string }>(ctx, `/forms/${encodeURIComponent(form.id)}/submit`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, result, `Created record ${result.recordId}.`);
    },
  }),
];

export const dashboardCommands = [
  command("dashboards list", {
    summary: "List dashboards visible on a base",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const dashboards = await listDashboards(ctx, base.id);
      printJsonOrTable(ctx, dashboards, dashboardRows(dashboards), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "scope", label: "SCOPE" },
        { key: "rows", label: "ROWS" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("dashboards get", {
    summary: "Show a dashboard",
    args: baseArgs,
    flags: { ...baseFlag, ...dashboardFlag },
    async run({ ctx, args, flags }) {
      const { dashboard } = await resolveDashboardFromCommand(ctx, args.args, flags.dashboard);
      if (ctx.options.output === "json") ctx.json(dashboard);
      else {
        ctx.print(`${dashboard.name} (${dashboard.shortId})`);
        if (dashboard.description) ctx.print(dashboard.description);
        ctx.print(`scope: ${dashboard.ownerUserId ? "personal" : "shared"}`);
        ctx.print(`rows: ${dashboard.config.rows.length}`);
        ctx.print(`id: ${dashboard.id}`);
      }
    },
  }),
  command("dashboards create", {
    summary: "Create a dashboard",
    description:
      "Dashboard config is a { rows: [...] } object. Widgets reference saved views, forms, workflows, tables, dashboards, or URLs by UUID.",
    args: baseArgs,
    flags: {
      ...baseFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Dashboard name" }),
      description: flag.string({ description: "Dashboard description" }),
      icon: flag.string({ description: "Dashboard icon class" }),
      config: flag.string({ description: "Dashboard config JSON object" }),
      shared: flag.boolean({ description: "Create a shared dashboard" }),
      personal: flag.boolean({ description: "Create a personal dashboard" }),
    },
    examples: [
      "cld grids dashboards create Bookshop --name Overview --shared --config '{\"rows\":[]}'",
      "cld grids dashboards create --base Bookshop --body-file dashboard.json",
    ],
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "dashboard JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        icon: flags.icon,
        config: flags.config ? JSON.parse(flags.config) : undefined,
        shared: flags.shared ? true : flags.personal ? false : undefined,
      });
      if (!body.name) throw new Error("Missing dashboard name. Pass --name or --body JSON.");
      const dashboard = await readApi<Dashboard>(ctx, `/dashboards/by-base/${encodeURIComponent(base.id)}`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, dashboard, `Created dashboard ${dashboard.name} (${dashboard.shortId}).`);
    },
  }),
  command("dashboards update", {
    summary: "Update a dashboard",
    args: baseArgs,
    flags: {
      ...baseFlag,
      ...dashboardFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Dashboard name" }),
      description: flag.string({ description: "Dashboard description" }),
      icon: flag.string({ description: "Dashboard icon class" }),
      config: flag.string({ description: "Dashboard config JSON object" }),
      shared: flag.boolean({ description: "Make the dashboard shared" }),
      personal: flag.boolean({ description: "Make the dashboard personal" }),
      position: flag.int({ min: 0, description: "Dashboard position" }),
    },
    async run({ ctx, args, flags }) {
      const { dashboard } = await resolveDashboardFromCommand(ctx, args.args, flags.dashboard);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "dashboard update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        icon: flags.icon,
        config: flags.config ? JSON.parse(flags.config) : undefined,
        shared: flags.shared ? true : flags.personal ? false : undefined,
        position: flags.position,
      });
      const updated = await readApi<Dashboard>(ctx, `/dashboards/${encodeURIComponent(dashboard.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated dashboard ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("dashboards delete", {
    summary: "Delete a dashboard",
    args: baseArgs,
    flags: { ...baseFlag, ...dashboardFlag, yes: confirmFlag("Delete this dashboard") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { dashboard } = await resolveDashboardFromCommand(ctx, args.args, flags.dashboard);
      await readApi<MessageResponse>(ctx, `/dashboards/${encodeURIComponent(dashboard.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: dashboard.id }, `Deleted dashboard ${dashboard.name} (${dashboard.shortId}).`);
    },
  }),
  command("dashboards restore", {
    summary: "Restore a deleted dashboard by UUID",
    args: { dashboard: arg.required({ description: "Dashboard UUID" }) },
    async run({ ctx, args }) {
      const dashboard = await readApi<Dashboard>(ctx, `/dashboards/${encodeURIComponent(args.dashboard)}/restore`, jsonRequest("POST"));
      printJsonOrMessage(ctx, dashboard, `Restored dashboard ${dashboard.name} (${dashboard.shortId}).`);
    },
  }),
  command("dashboards widgets resolve", {
    summary: "Resolve one dashboard widget",
    args: baseArgs,
    flags: { ...baseFlag, ...dashboardFlag, body: JSON_BODY_INPUT },
    examples: [
      "cld grids dashboards widgets resolve Bookshop Overview --body-file widget.json",
      'cld grids dashboards widgets resolve --base Bookshop --dashboard Overview --body \'{"id":"w1","kind":"markdown","markdown":"Hello"}\'',
    ],
    async run({ ctx, args, flags }) {
      const { dashboard } = await resolveDashboardFromCommand(ctx, args.args, flags.dashboard);
      const body = await readJsonInput<Record<string, unknown>>(flags.body, "dashboard widget JSON", true);
      const resolved = await readApi<unknown>(
        ctx,
        `/dashboards/${encodeURIComponent(dashboard.id)}/widgets/resolve`,
        jsonRequest("POST", body),
      );
      if (ctx.options.output === "json") ctx.json(resolved);
      else ctx.print(JSON.stringify(resolved, null, 2));
    },
  }),
  command("dashboards widgets run", {
    summary: "Run a dashboard workflow-button widget",
    args: {
      args: arg.rest({ valueLabel: "base-dashboard-widget", description: "Optional base, then dashboard and widget id." }),
    },
    flags: { ...baseFlag, ...dashboardFlag, widget: flag.string({ description: "Dashboard widget id" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.dashboard && flags.widget ? 0 : 2);
      const dashboard = await resolveDashboard(ctx, base.id, flags.dashboard ?? requireRestArg(rest, 0, "dashboard"));
      const widgetId = flags.widget ?? requireRestArg(flags.dashboard ? rest : rest.slice(1), 0, "widget");
      const run = await readApi<WorkflowRun>(
        ctx,
        `/dashboards/${encodeURIComponent(dashboard.id)}/widgets/${encodeURIComponent(widgetId)}/run`,
        jsonRequest("POST"),
      );
      printJsonOrMessage(ctx, run, `Queued workflow run ${run.id} (${run.status}).`);
    },
  }),
];
