import { arg, command, confirmFlag, flag, paginationFlags, printStructured } from "@valentinkolb/cloud/cli";
import type { Base, Field, Table } from "../contracts";
import {
  baseArgs,
  baseFlag,
  baseRows,
  GRIDS_BASE_DEFAULT_KEY,
  listBases,
  requireDefaultBaseRef,
  resolveBase,
  resolveBaseFromCommand,
} from "./resources";
import {
  applyDefined,
  JSON_BODY_INPUT,
  jsonRequest,
  type MessageResponse,
  printJsonOrMessage,
  printJsonOrTable,
  readApi,
  readJsonInput,
} from "./runtime";

type TrashedForm = {
  id: string;
  tableId: string;
  name: string;
  deletedAt: string | null;
};

type BaseTrash = {
  tables: Table[];
  fields: Field[];
  forms: TrashedForm[];
};

const trashRows = (trash: BaseTrash) => [
  ...trash.tables.map((item) => ({ kind: "table", name: item.name, parent: "-", deletedAt: item.deletedAt, id: item.id })),
  ...trash.fields.map((item) => ({ kind: "field", name: item.name, parent: item.tableId, deletedAt: item.deletedAt, id: item.id })),
  ...trash.forms.map((item) => ({ kind: "form", name: item.name, parent: item.tableId, deletedAt: item.deletedAt, id: item.id })),
];

export const baseCrudCommands = [
  command("list", {
    summary: "List Grids bases",
    flags: {
      q: flag.string({ aliases: ["query"], description: "Search bases" }),
      ...paginationFlags({ defaultPerPage: 100, maxPerPage: 500 }),
    },
    async run({ ctx, flags }) {
      const perPage = flags.perPage ?? 100;
      const page = flags.page ?? 1;
      const payload = await listBases(ctx, { q: flags.q, limit: perPage, offset: (page - 1) * perPage });
      printJsonOrTable(ctx, payload, baseRows(payload.items), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "description", label: "DESCRIPTION" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("use", {
    summary: "Set the default Grids base",
    args: { base: arg.required({ description: "Base id, short id, or exact name" }) },
    async run({ ctx, args }) {
      const base = await resolveBase(ctx, args.base);
      await ctx.setDefault(GRIDS_BASE_DEFAULT_KEY, base.shortId);
      printJsonOrMessage(ctx, { base, defaultBase: base.shortId }, `Using Grids base ${base.name} (${base.shortId}).`);
    },
  }),
  command("current", {
    summary: "Show the default Grids base",
    async run({ ctx }) {
      const base = await resolveBase(ctx, await requireDefaultBaseRef(ctx));
      printJsonOrMessage(ctx, { base, defaultBase: base.shortId }, `${base.name} (${base.shortId})`);
    },
  }),
  command("bases list", {
    summary: "List Grids bases",
    flags: {
      q: flag.string({ aliases: ["query"], description: "Search bases" }),
      ...paginationFlags({ defaultPerPage: 100, maxPerPage: 500 }),
    },
    async run({ ctx, flags }) {
      const perPage = flags.perPage ?? 100;
      const page = flags.page ?? 1;
      const payload = await listBases(ctx, { q: flags.q, limit: perPage, offset: (page - 1) * perPage });
      printJsonOrTable(ctx, payload, baseRows(payload.items), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "description", label: "DESCRIPTION" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("bases get", {
    summary: "Show a Grids base",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      if (!printStructured(ctx, base)) {
        ctx.print(`${base.name} (${base.shortId})`);
        if (base.description) ctx.print(base.description);
        ctx.print(`id: ${base.id}`);
        ctx.print(`updated: ${base.updatedAt}`);
      }
    },
  }),
  command("bases trash", {
    summary: "List deleted resources that can be restored in a base",
    description:
      "Requires base admin access. Parent tables contain their own deleted fields and forms, so nested items are not duplicated.",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const trash = await readApi<BaseTrash>(ctx, `/bases/${encodeURIComponent(base.id)}/trash`);
      printJsonOrTable(ctx, trash, trashRows(trash), [
        { key: "kind", label: "TYPE" },
        { key: "name", label: "NAME" },
        { key: "parent", label: "PARENT TABLE" },
        { key: "deletedAt", label: "DELETED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("bases create", {
    summary: "Create a Grids base",
    args: { name: arg.required({ description: "Base name" }) },
    flags: {
      description: flag.string({ description: "Base description" }),
      use: flag.boolean({ description: "Use the new base as default" }),
    },
    async run({ ctx, args, flags }) {
      const base = await readApi<Base>(ctx, "/bases", jsonRequest("POST", { name: args.name, description: flags.description ?? null }));
      if (flags.use) await ctx.setDefault(GRIDS_BASE_DEFAULT_KEY, base.shortId);
      printJsonOrMessage(ctx, base, `Created ${base.name} (${base.shortId}).${flags.use ? " Using it as default." : ""}`);
    },
  }),
  command("bases update", {
    summary: "Update a Grids base",
    args: baseArgs,
    flags: {
      ...baseFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Base name" }),
      description: flag.string({ description: "Base description" }),
    },
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "base update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
      });
      const updated = await readApi<Base>(ctx, `/bases/${encodeURIComponent(base.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("bases delete", {
    summary: "Delete a Grids base",
    args: baseArgs,
    flags: { ...baseFlag, yes: confirmFlag("Delete this Grids base") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      await readApi<MessageResponse>(ctx, `/bases/${encodeURIComponent(base.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: base.id }, `Deleted ${base.name} (${base.shortId}).`);
    },
  }),
  command("bases restore", {
    summary: "Restore a deleted Grids base",
    args: { base: arg.required({ description: "Base UUID" }) },
    async run({ ctx, args }) {
      const restored = await readApi<Base>(ctx, `/bases/${encodeURIComponent(args.base)}/restore`, jsonRequest("POST"));
      printJsonOrMessage(ctx, restored, `Restored ${restored.name} (${restored.shortId}).`);
    },
  }),
];
