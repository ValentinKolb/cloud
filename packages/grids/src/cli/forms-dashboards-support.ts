import type { CloudCliContext } from "@valentinkolb/cloud/cli";
import { flag } from "@valentinkolb/cloud/cli";
import type { Base, Dashboard, DashboardConfig, Table } from "../contracts";
import { assertBaseScoped, listTables, resolveBaseFromCommand, resolveTable, UUID_RE } from "./resources";
import { exactMatch, readApi, requireRestArg } from "./runtime";

export const DASHBOARD_REFERENCE = {
  config: {
    rows: "Array of rows. Every row has id, kind='row', height sm|md|lg, and up to 12 cells.",
    span: "Optional cell width from 1 to 12 columns.",
    sources: {
      view: { kind: "view", viewId: "<view-uuid>" },
      gql: { kind: "gql", source: "from table Orders\naggregate sum(Total) as revenue" },
    },
  },
  widgetShapes: {
    stat: {
      required: ["id", "kind", "source"],
      optional: ["span", "title", "trend", "icon", "valueFormat", "tone", "sub"],
      notes: "Renders the first aggregate value. tone is neutral|blue|green|amber|red. A trend adds source and windowSize 2..60.",
    },
    chart: {
      required: ["id", "kind", "chartType", "source"],
      optional: ["span", "title", "subtitle", "limit", "valueFormat", "xAxisLabel", "yAxisLabel"],
      chartTypes: {
        donut: "One group and at least one aggregate.",
        bar: "One group and at least one aggregate.",
        line: "One group and one or more aggregates; each aggregate becomes a series.",
        sparkline: "One group and at least one aggregate.",
        scatter: "One group and at least two aggregates; the first two become x and y.",
      },
    },
    view: {
      required: ["id", "kind", "source"],
      optional: ["span", "title"],
      notes: "Renders tabular rows or grouped query results.",
    },
    "view-stats": {
      required: ["id", "kind", "source"],
      optional: ["span", "title"],
      notes: "Renders values from the first source row or group as a compact stat grid.",
    },
    form: {
      required: ["id", "kind", "formId"],
      optional: ["span", "title"],
      notes: "formId must be a form UUID visible in the dashboard base.",
    },
    markdown: {
      required: ["id", "kind", "markdown"],
      optional: ["span", "title"],
      notes: "markdown accepts at most 20,000 characters.",
    },
    link: {
      required: ["id", "kind", "target"],
      optional: ["span", "title", "description", "icon"],
      targets: [
        { kind: "dashboard", dashboardId: "<dashboard-uuid>" },
        { kind: "table", tableId: "<table-uuid>" },
        { kind: "view", viewId: "<view-uuid>" },
        { kind: "form", formId: "<form-uuid>" },
        { kind: "url", url: "https://example.test" },
      ],
    },
    "workflow-button": {
      required: ["id", "kind", "launcherId"],
      optional: ["span", "title", "description", "buttonLabel"],
      notes: "launcherId must be an enabled workflow launcher UUID authorized for this dashboard.",
    },
  },
  widgetKinds: {
    stat: "First aggregate value from a view or inline GQL source.",
    chart: "Grouped source rendered as donut, bar, line, sparkline, or scatter.",
    view: "Tabular rows or grouped results from a view or inline GQL source.",
    "view-stats": "Compact stat grid from the first source row or group.",
    form: "Embedded form selected by formId.",
    markdown: "Static Markdown content.",
    link: "Link to a dashboard, table, view, form, or absolute URL.",
    "workflow-button": "Button backed by a workflow launcher UUID.",
  },
  valueFormat: {
    appliesTo: ["stat", "chart"],
    styles: ["number", "integer", "percent"],
    rules: [
      "integer does not accept decimalPlaces.",
      "number may set decimalPlaces, unit, and unitPosition prefix|suffix.",
      "percent expects a fraction: 0.19 renders as 19%.",
      "Formatting never changes canonical query values.",
    ],
    example: { style: "number", decimalPlaces: 2, unit: "EUR", unitPosition: "suffix" },
  },
  example: {
    rows: [
      {
        id: "summary",
        kind: "row",
        height: "sm",
        cells: [
          {
            id: "revenue",
            kind: "stat",
            span: 4,
            title: "Revenue",
            source: { kind: "gql", source: "from table Orders\naggregate sum(Total) as revenue" },
            valueFormat: { style: "number", decimalPlaces: 2, unit: "EUR", unitPosition: "suffix" },
          },
        ],
      },
    ],
  } satisfies DashboardConfig,
};

export type Form = {
  id: string;
  shortId: string;
  tableId: string;
  name: string;
  config: unknown;
  publicToken: string | null;
  isActive: boolean;
  ownerUserId: string | null;
  position: number;
  isDefault: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const formFlag = {
  form: flag.string({ description: "Form id, short id, or exact name" }),
};

export const dashboardFlag = {
  dashboard: flag.string({ description: "Dashboard id, short id, or exact name" }),
};

export const listForms = (ctx: CloudCliContext, tableId: string): Promise<Form[]> =>
  readApi<Form[]>(ctx, `/forms/by-table/${encodeURIComponent(tableId)}`);

const getFormById = (ctx: CloudCliContext, formId: string): Promise<Form> => readApi<Form>(ctx, `/forms/${encodeURIComponent(formId)}`);

const assertFormScope = async (ctx: CloudCliContext, base: Base, table: Table | null, form: Form) => {
  if (table) {
    if (form.tableId !== table.id) throw new Error("Form does not belong to the selected table.");
    return;
  }
  const tables = await listTables(ctx, base.id);
  if (!tables.some((item) => item.id === form.tableId)) throw new Error("Form does not belong to the selected base.");
};

const resolveForm = async (ctx: CloudCliContext, base: Base, table: Table | null, ref: string): Promise<Form> => {
  if (UUID_RE.test(ref)) {
    const form = await getFormById(ctx, ref);
    await assertFormScope(ctx, base, table, form);
    return form;
  }
  if (!table) throw new Error("Resolving a form by name or short id requires --table.");
  return exactMatch(
    await listForms(ctx, table.id),
    ref,
    [(form) => form.id, (form) => form.shortId, (form) => form.name],
    "form",
    (form) => `${form.name} (${form.shortId || "default"})`,
  );
};

export const listDashboards = (ctx: CloudCliContext, baseId: string): Promise<Dashboard[]> =>
  readApi<Dashboard[]>(ctx, `/dashboards/by-base/${encodeURIComponent(baseId)}`);

export const resolveDashboard = async (ctx: CloudCliContext, baseId: string, ref: string): Promise<Dashboard> => {
  const dashboard = UUID_RE.test(ref)
    ? await readApi<Dashboard>(ctx, `/dashboards/${encodeURIComponent(ref)}`)
    : exactMatch(
        await listDashboards(ctx, baseId),
        ref,
        [(item) => item.id, (item) => item.shortId, (item) => item.name],
        "dashboard",
        (item) => `${item.name} (${item.shortId})`,
      );
  assertBaseScoped("Dashboard", baseId, dashboard.baseId);
  return dashboard;
};

export const formRows = (items: Form[]) =>
  items.map((form) => ({
    shortId: form.shortId || "default",
    name: form.name,
    active: form.isActive ? "yes" : "no",
    public: form.publicToken ? "yes" : "no",
    fields:
      typeof form.config === "object" && form.config !== null && Array.isArray((form.config as { fields?: unknown }).fields)
        ? (form.config as { fields: unknown[] }).fields.length
        : 0,
    updatedAt: form.updatedAt,
    id: form.id,
  }));

export const dashboardRows = (items: Dashboard[]) =>
  items.map((dashboard) => ({
    shortId: dashboard.shortId,
    name: dashboard.name,
    scope: dashboard.ownerUserId ? "personal" : "shared",
    rows: dashboard.config.rows.length,
    updatedAt: dashboard.updatedAt,
    id: dashboard.id,
  }));

export const resolveFormFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  refs: { table?: string; form?: string },
): Promise<{ base: Base; table: Table | null; form: Form }> => {
  const { base, rest } = await resolveBaseFromCommand(ctx, args, refs.table || refs.form ? 0 : 2);
  const table = refs.table
    ? await resolveTable(ctx, base.id, refs.table)
    : rest.length >= 2
      ? await resolveTable(ctx, base.id, rest[0]!)
      : null;
  const formRef = refs.form ?? (table ? rest[1] : rest[0]);
  if (!formRef) throw new Error("Missing form.");
  return { base, table, form: await resolveForm(ctx, base, table, formRef) };
};

export const resolveDashboardFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  dashboardRef: string | undefined,
): Promise<{ base: Base; dashboard: Dashboard }> => {
  const { base, rest } = await resolveBaseFromCommand(ctx, args, dashboardRef ? 0 : 1);
  const ref = dashboardRef ?? requireRestArg(rest, 0, "dashboard");
  return { base, dashboard: await resolveDashboard(ctx, base.id, ref) };
};
