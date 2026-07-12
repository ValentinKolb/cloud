import type { CloudCliContext } from "@valentinkolb/cloud/cli";
import { flag } from "@valentinkolb/cloud/cli";
import type { Base, Dashboard, Table } from "../contracts";
import { assertBaseScoped, listTables, resolveBaseFromCommand, resolveTable, UUID_RE } from "./resources";
import { exactMatch, readApi, requireRestArg } from "./runtime";

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
