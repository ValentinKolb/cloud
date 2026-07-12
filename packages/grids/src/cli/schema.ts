import { arg, command, confirmFlag, flag } from "@valentinkolb/cloud/cli";
import type { Field, Table } from "../contracts";
import {
  baseArgs,
  baseFlag,
  listFields,
  listTables,
  resolveBaseFromCommand,
  resolveField,
  resolveTable,
  tableArgs,
  tableFlag,
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
  requireRestArg,
} from "./runtime";
import {
  type FieldDependentsResponse,
  fieldRows,
  fieldTypeReference,
  fieldTypeReferences,
  fieldTypeRows,
  printFieldTypeReference,
  tableRows,
} from "./schema-support";

export const tableCommands = [
  command("tables list", {
    summary: "List tables in a base",
    args: baseArgs,
    flags: baseFlag,
    async run({ ctx, args }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const tables = await listTables(ctx, base.id);
      printJsonOrTable(ctx, tables, tableRows(tables), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "fields", label: "FIELDS" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("tables get", {
    summary: "Show a table",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      if (ctx.options.output === "json") ctx.json(table);
      else {
        ctx.print(`${table.name} (${table.shortId})`);
        if (table.description) ctx.print(table.description);
        ctx.print(`id: ${table.id}`);
        ctx.print(`fields: ${table.columns.length}`);
      }
    },
  }),
  command("tables create", {
    summary: "Create a table",
    args: baseArgs,
    flags: {
      ...baseFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Table name" }),
      description: flag.string({ description: "Table description" }),
      icon: flag.string({ description: "Table icon class" }),
    },
    examples: [
      "cld grids tables create Bookshop --name Authors --description 'People who wrote books'",
      'cld grids tables create --base Bookshop --body \'{"name":"Orders","icon":"ti ti-shopping-cart"}\'',
    ],
    async run({ ctx, args, flags }) {
      const { base } = await resolveBaseFromCommand(ctx, args.args, 0);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "table JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        icon: flags.icon ?? (body.icon === undefined ? "ti ti-table" : undefined),
      });
      if (!body.name) throw new Error("Missing table name. Pass --name or --body JSON.");
      const table = await readApi<Table>(ctx, `/tables/by-base/${encodeURIComponent(base.id)}`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, table, `Created table ${table.name} (${table.shortId}).`);
    },
  }),
  command("tables update", {
    summary: "Update a table",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Table name" }),
      description: flag.string({ description: "Table description" }),
      icon: flag.string({ description: "Table icon class" }),
      disableDirectInsert: flag.boolean({ name: "disable-direct-insert", description: "Disable direct record insertion" }),
      enableDirectInsert: flag.boolean({ name: "enable-direct-insert", description: "Enable direct record insertion" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "table update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        icon: flags.icon,
        disableDirectInsert: flags.disableDirectInsert ? true : flags.enableDirectInsert ? false : undefined,
      });
      const updated = await readApi<Table>(ctx, `/tables/${encodeURIComponent(table.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated table ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("tables delete", {
    summary: "Delete a table",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, yes: confirmFlag("Delete this table") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      await readApi<MessageResponse>(ctx, `/tables/${encodeURIComponent(table.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: table.id }, `Deleted table ${table.name} (${table.shortId}).`);
    },
  }),
  command("tables restore", {
    summary: "Restore a deleted table by UUID",
    args: { table: arg.required({ description: "Table UUID" }) },
    async run({ ctx, args }) {
      const table = await readApi<Table>(ctx, `/tables/${encodeURIComponent(args.table)}/restore`, jsonRequest("POST"));
      printJsonOrMessage(ctx, table, `Restored table ${table.name} (${table.shortId}).`);
    },
  }),
];

export const fieldCommands = [
  command("fields types", {
    summary: "List all Grids field types and their record payload shape",
    description: "Use this before creating fields or writing record JSON. Machine-readable output is available with --json.",
    async run({ ctx }) {
      const refs = fieldTypeReferences();
      printJsonOrTable(ctx, refs, fieldTypeRows(refs), [
        { key: "type", label: "TYPE" },
        { key: "category", label: "CATEGORY" },
        { key: "writable", label: "RECORD" },
        { key: "recordValue", label: "VALUE" },
        { key: "config", label: "CONFIG" },
      ]);
    },
  }),
  command("fields type", {
    summary: "Show one field type reference",
    args: { type: arg.required({ description: "Field type, for example text, number, relation, formula" }) },
    examples: ["cld grids fields type select", "cld grids fields type relation --json"],
    async run({ ctx, args }) {
      printFieldTypeReference(ctx, fieldTypeReference(args.type));
    },
  }),
  command("fields list", {
    summary: "List fields in a table",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const fields = await listFields(ctx, table.id);
      printJsonOrTable(ctx, fields, fieldRows(fields), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "type", label: "TYPE" },
        { key: "required", label: "REQ" },
        { key: "presentable", label: "LABEL" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("fields get", {
    summary: "Show a field",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, field: flag.string({ description: "Field id, short id, or exact name" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.field ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const fieldRef = flags.field ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "field");
      const field = await resolveField(ctx, table.id, fieldRef);
      if (ctx.options.output === "json") ctx.json(field);
      else {
        ctx.print(`${field.name} (${field.shortId})`);
        ctx.print(`type: ${field.type}`);
        ctx.print(`id: ${field.id}`);
      }
    },
  }),
  command("fields create", {
    summary: "Create a field",
    description: "Run `cld grids fields types` or `cld grids fields type <type>` to inspect valid field types and config JSON.",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Field name" }),
      type: flag.string({ description: "Field type" }),
      description: flag.string({ description: "Field description" }),
      config: flag.string({ description: "Field config JSON object" }),
      required: flag.boolean({ description: "Mark field required" }),
      presentable: flag.boolean({ description: "Use field as record label" }),
      hideInTable: flag.boolean({ name: "hide-in-table", description: "Hide field in table views" }),
    },
    examples: [
      'cld grids fields create Bookshop Authors --name Email --type text --config \'{"regex":"^[^@]+@[^@]+$"}\'',
      'cld grids fields create Bookshop Orders --name Customer --type relation --config \'{"targetTableId":"<table-uuid>","cardinality":"single"}\'',
      "cld grids fields create Bookshop Orders --body-file field.json",
    ],
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "field JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        type: flags.type,
        description: flags.description,
        config: flags.config ? JSON.parse(flags.config) : undefined,
        required: flags.required ? true : undefined,
        presentable: flags.presentable ? true : undefined,
        hideInTable: flags.hideInTable ? true : undefined,
      });
      if (!body.name) throw new Error("Missing field name. Pass --name or --body JSON.");
      if (!body.type) throw new Error("Missing field type. Pass --type or --body JSON.");
      const field = await readApi<Field>(ctx, `/fields/by-table/${encodeURIComponent(table.id)}`, jsonRequest("POST", body));
      printJsonOrMessage(ctx, field, `Created field ${field.name} (${field.shortId}).`);
    },
  }),
  command("fields update", {
    summary: "Update a field",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      field: flag.string({ description: "Field id, short id, or exact name" }),
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Field name" }),
      description: flag.string({ description: "Field description" }),
      config: flag.string({ description: "Field config JSON object" }),
      required: flag.boolean({ description: "Mark field required" }),
      optional: flag.boolean({ description: "Mark field optional" }),
      presentable: flag.boolean({ description: "Use field as record label" }),
      notPresentable: flag.boolean({ name: "not-presentable", description: "Do not use field as record label" }),
      hideInTable: flag.boolean({ name: "hide-in-table", description: "Hide field in table views" }),
      showInTable: flag.boolean({ name: "show-in-table", description: "Show field in table views" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.field ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const field = await resolveField(ctx, table.id, flags.field ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "field"));
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "field update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        config: flags.config ? JSON.parse(flags.config) : undefined,
        required: flags.required ? true : flags.optional ? false : undefined,
        presentable: flags.presentable ? true : flags.notPresentable ? false : undefined,
        hideInTable: flags.hideInTable ? true : flags.showInTable ? false : undefined,
      });
      const updated = await readApi<Field>(ctx, `/fields/${encodeURIComponent(field.id)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated field ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("fields delete", {
    summary: "Delete a field",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      field: flag.string({ description: "Field id, short id, or exact name" }),
      yes: confirmFlag("Delete this field"),
    },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.field ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const field = await resolveField(ctx, table.id, flags.field ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "field"));
      await readApi<MessageResponse>(ctx, `/fields/${encodeURIComponent(field.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: field.id }, `Deleted field ${field.name} (${field.shortId}).`);
    },
  }),
  command("fields restore", {
    summary: "Restore a deleted field by UUID",
    args: { field: arg.required({ description: "Field UUID" }) },
    async run({ ctx, args }) {
      const field = await readApi<Field>(ctx, `/fields/${encodeURIComponent(args.field)}/restore`, jsonRequest("POST"));
      printJsonOrMessage(ctx, field, `Restored field ${field.name} (${field.shortId}).`);
    },
  }),
  command("fields dependents", {
    summary: "Show field dependents",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, field: flag.string({ description: "Field id, short id, or exact name" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? (flags.field ? 0 : 1) : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const field = await resolveField(ctx, table.id, flags.field ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "field"));
      const payload = await readApi<FieldDependentsResponse>(ctx, `/fields/${encodeURIComponent(field.id)}/dependents`);
      if (ctx.options.output === "json") ctx.json(payload);
      else {
        ctx.print(payload.hasBlocking ? "Blocking dependents found." : "No blocking dependents.");
        ctx.table(payload.dependents as Record<string, unknown>[], []);
      }
    },
  }),
  command("fields reorder", {
    summary: "Reorder fields in a table",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      fieldIds: flag.stringList({ name: "field-ids", description: "Comma-separated field ids in desired order" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      if (flags.fieldIds.length === 0) throw new Error("Pass --field-ids.");
      await readApi<MessageResponse>(
        ctx,
        `/fields/by-table/${encodeURIComponent(table.id)}/reorder`,
        jsonRequest("POST", { fieldIds: flags.fieldIds }),
      );
      printJsonOrMessage(ctx, { reordered: flags.fieldIds }, `Reordered ${flags.fieldIds.length} fields.`);
    },
  }),
];
