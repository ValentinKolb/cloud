import type { CloudCliContext } from "@valentinkolb/cloud/cli";
import { arg, flag } from "@valentinkolb/cloud/cli";
import type { Base, Field, Table } from "../contracts";
import { exactMatch, queryString, readApi, requireRestArg } from "./runtime";

type BasePage = { items: Base[]; total: number; limit: number; offset: number };

export const GRIDS_BASE_DEFAULT_KEY = "grids.base";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const baseFlag = {
  base: flag.string({ description: "Grids base id, short id, or exact name" }),
};

export const tableFlag = {
  table: flag.string({ description: "Table id, short id, or exact name" }),
};

export const baseArgs = {
  args: arg.rest({ valueLabel: "base-or-args", description: "Optional leading base followed by command arguments." }),
};

export const tableArgs = {
  args: arg.rest({ valueLabel: "base-table-args", description: "Optional leading base, then table and command arguments." }),
};

export const listBases = (ctx: CloudCliContext, params: { q?: string; limit?: number; offset?: number } = {}): Promise<BasePage> =>
  readApi<BasePage>(
    ctx,
    `/bases${queryString({
      q: params.q,
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
    })}`,
  );

export const resolveBase = async (ctx: CloudCliContext, ref: string): Promise<Base> => {
  if (UUID_RE.test(ref)) return readApi<Base>(ctx, `/bases/${encodeURIComponent(ref)}`);
  const page = await listBases(ctx, { q: ref, limit: 500 });
  return exactMatch(
    page.items,
    ref,
    [(base) => base.id, (base) => base.shortId, (base) => base.name],
    "base",
    (base) => `${base.name} (${base.shortId})`,
  );
};

export const requireDefaultBaseRef = async (ctx: CloudCliContext): Promise<string> => {
  const value = await ctx.getDefault(GRIDS_BASE_DEFAULT_KEY);
  if (!value) throw new Error("Missing Grids base. Pass --base <base> or run `cld grids use <base>`.");
  return value;
};

const baseRefFromArgs = async (
  ctx: CloudCliContext,
  args: string[],
  requiredTrailingArgs: number,
): Promise<{ baseRef: string; rest: string[] }> => {
  const flagged = typeof ctx.flags.base === "string" ? ctx.flags.base : undefined;
  if (flagged) return { baseRef: flagged, rest: args };
  if (args.length > requiredTrailingArgs) return { baseRef: requireRestArg(args, 0, "base"), rest: args.slice(1) };
  return { baseRef: await requireDefaultBaseRef(ctx), rest: args };
};

export const resolveBaseFromCommand = async (
  ctx: CloudCliContext,
  args: string[],
  requiredTrailingArgs: number,
): Promise<{ base: Base; rest: string[] }> => {
  const { baseRef, rest } = await baseRefFromArgs(ctx, args, requiredTrailingArgs);
  return { base: await resolveBase(ctx, baseRef), rest };
};

export const listTables = (ctx: CloudCliContext, baseId: string): Promise<Table[]> =>
  readApi<Table[]>(ctx, `/tables/by-base/${encodeURIComponent(baseId)}`);

export const resolveTable = async (ctx: CloudCliContext, baseId: string, ref: string): Promise<Table> =>
  exactMatch(
    await listTables(ctx, baseId),
    ref,
    [(table) => table.id, (table) => table.shortId, (table) => table.name],
    "table",
    (table) => `${table.name} (${table.shortId})`,
  );

export const resolveTableFromFlags = async (ctx: CloudCliContext, base: Base, ref: string | undefined): Promise<Table | null> =>
  ref ? resolveTable(ctx, base.id, ref) : null;

export const listFields = (ctx: CloudCliContext, tableId: string): Promise<Field[]> =>
  readApi<Field[]>(ctx, `/fields/by-table/${encodeURIComponent(tableId)}`);

export const resolveField = async (ctx: CloudCliContext, tableId: string, ref: string): Promise<Field> =>
  exactMatch(
    await listFields(ctx, tableId),
    ref,
    [(field) => field.id, (field) => field.shortId, (field) => field.name],
    "field",
    (field) => `${field.name} (${field.shortId})`,
  );

export const assertBaseScoped = (kind: string, expectedBaseId: string, actualBaseId: string) => {
  if (actualBaseId !== expectedBaseId) throw new Error(`${kind} does not belong to the selected base.`);
};

export const baseRows = (items: Base[]) =>
  items.map((base) => ({
    shortId: base.shortId,
    name: base.name,
    description: base.description ?? "",
    updatedAt: base.updatedAt,
    id: base.id,
  }));
