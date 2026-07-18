import { arg, command, confirmFlag, flag, paginationFlags } from "@valentinkolb/cloud/cli";
import type {
  FederatedDraftInput,
  FederatedRevisionView,
  FederatedSourceCandidatePage,
  FederatedSourcePublication,
  FederatedTableConfig,
  FederatedValidation,
  Field,
  Table,
  TableKind,
} from "../contracts";
import {
  baseArgs,
  baseFlag,
  listFields,
  listTables,
  resolveBase,
  resolveBaseFromCommand,
  resolveField,
  resolveTable,
  tableArgs,
  tableFlag,
} from "./resources";
import {
  applyDefined,
  exactMatch,
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

type FriendlyFederatedMapping = {
  target: string;
  source: string;
  options?: Record<string, string>;
};

type FriendlyFederatedSource = {
  base?: string;
  table: string;
  mappings: FriendlyFederatedMapping[];
};

type FriendlyFederatedDraft = { sources: FriendlyFederatedSource[] };

const selectOptions = (field: Field): Array<{ id: string; label: string }> => {
  const options = (field.config as { options?: unknown }).options;
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) => {
    if (!option || typeof option !== "object") return [];
    const { id, label } = option as { id?: unknown; label?: unknown };
    return typeof id === "string" && typeof label === "string" ? [{ id, label }] : [];
  });
};

const resolveSelectOption = (field: Field, ref: string): string => {
  const options = selectOptions(field);
  const matches = options.filter((option) => option.id === ref || option.label.toLowerCase() === ref.toLowerCase());
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length > 1) throw new Error(`Ambiguous option "${ref}" on field "${field.name}".`);
  throw new Error(`Unknown option "${ref}" on field "${field.name}".`);
};

const resolveFieldFromList = (fields: Field[], ref: string): Field =>
  exactMatch(
    fields,
    ref,
    [(field) => field.id, (field) => field.shortId, (field) => field.name],
    "field",
    (field) => `${field.name} (${field.shortId})`,
  );

const friendlyFederatedDraft = async (
  ctx: Parameters<typeof resolveBase>[0],
  targetBaseId: string,
  targetTable: Table,
  input: FriendlyFederatedDraft,
): Promise<FederatedDraftInput> => {
  if (!Array.isArray(input.sources)) throw new Error('Combined table JSON must contain a "sources" array.');
  const sourceTableIds: string[] = [];
  const mappings: FederatedDraftInput["mappings"] = [];
  const targetFields = await listFields(ctx, targetTable.id);

  for (const sourceInput of input.sources) {
    const sourceBase = await resolveBase(ctx, sourceInput.base ?? targetBaseId);
    const sourceTable = await resolveTable(ctx, sourceBase.id, sourceInput.table);
    if (sourceTable.kind !== "stored") throw new Error(`Source table "${sourceTable.name}" must be a stored table.`);
    if (sourceTableIds.includes(sourceTable.id)) throw new Error(`Source table "${sourceTable.name}" is listed more than once.`);
    sourceTableIds.push(sourceTable.id);
    const sourceFields = await listFields(ctx, sourceTable.id);

    for (const mappingInput of sourceInput.mappings ?? []) {
      const targetField = resolveFieldFromList(targetFields, mappingInput.target);
      const sourceField = resolveFieldFromList(sourceFields, mappingInput.source);
      const optionMap =
        targetField.type === "select" && sourceField.type === "select"
          ? Object.fromEntries(
              Object.entries(mappingInput.options ?? {}).map(([sourceOption, targetOption]) => [
                resolveSelectOption(sourceField, sourceOption),
                resolveSelectOption(targetField, targetOption),
              ]),
            )
          : undefined;
      mappings.push({
        targetFieldId: targetField.id,
        sourceTableId: sourceTable.id,
        sourceFieldId: sourceField.id,
        config: optionMap ? { optionMap } : {},
      });
    }
  }
  return { sourceTableIds, mappings };
};

const readFederatedDraftInput = async (
  ctx: Parameters<typeof resolveBase>[0],
  targetBaseId: string,
  targetTable: Table,
  body: unknown,
): Promise<FederatedDraftInput> => {
  if (body && typeof body === "object" && Array.isArray((body as FederatedDraftInput).sourceTableIds)) {
    return body as FederatedDraftInput;
  }
  return friendlyFederatedDraft(ctx, targetBaseId, targetTable, body as FriendlyFederatedDraft);
};

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
        { key: "kind", label: "KIND" },
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
        ctx.print(`kind: ${table.kind === "federated" ? "combined" : "stored"}`);
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
      kind: flag.string({ description: "Table kind: stored or federated (Combined table)" }),
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
      const kind = flags.kind as TableKind | undefined;
      if (kind !== undefined && kind !== "stored" && kind !== "federated") {
        throw new Error('Invalid --kind. Use "stored" or "federated".');
      }
      applyDefined(body, {
        name: flags.name,
        kind,
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
  command("tables combined get", {
    summary: "Show the draft and published revision of a Combined table",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      if (table.kind !== "federated") throw new Error(`Table "${table.name}" is not a Combined table.`);
      const config = await readApi<FederatedTableConfig>(ctx, `/tables/${encodeURIComponent(table.id)}/federation`);
      if (ctx.options.output === "json") ctx.json(config);
      else {
        ctx.print(`${table.name} (${table.shortId})`);
        ctx.print(
          `draft: revision ${config.draft.revision} · ${config.draft.sources.length} sources · ${config.draft.diagnostics.length} diagnostics`,
        );
        ctx.print(
          config.current
            ? `published: revision ${config.current.revision} · ${config.current.status} · ${config.current.sources.length} sources`
            : "published: none",
        );
      }
    },
  }),
  command("tables combined candidates", {
    summary: "List source tables you may publish into a Combined table",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      q: flag.string({ aliases: ["query"], description: "Search source bases and tables" }),
      ...paginationFlags({ defaultPerPage: 50, maxPerPage: 100 }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      if (table.kind !== "federated") throw new Error(`Table "${table.name}" is not a Combined table.`);
      const perPage = flags.perPage ?? 50;
      const page = flags.page ?? 1;
      const query = new URLSearchParams({ limit: String(perPage), offset: String((page - 1) * perPage) });
      if (flags.q) query.set("q", flags.q);
      const candidates = await readApi<FederatedSourceCandidatePage>(
        ctx,
        `/tables/${encodeURIComponent(table.id)}/federation/source-candidates?${query}`,
      );
      const rows = candidates.items.map((candidate) => ({
        base: candidate.base.name,
        baseShort: candidate.base.shortId,
        table: candidate.table.name,
        tableShort: candidate.table.shortId,
        fields: candidate.fieldCount,
      }));
      printJsonOrTable(ctx, candidates, rows, [
        { key: "base", label: "BASE" },
        { key: "baseShort", label: "BASE SHORT" },
        { key: "table", label: "TABLE" },
        { key: "tableShort", label: "TABLE SHORT" },
        { key: "fields", label: "FIELDS" },
      ]);
    },
  }),
  command("tables combined publications", {
    summary: "List Combined tables that publish a stored source table",
    description: "Requires admin access to the source base. The result includes the exact mapped field scope and revocation status.",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "source table"));
      if (table.kind !== "stored") throw new Error(`Table "${table.name}" is not a stored source table.`);
      const publications = await readApi<FederatedSourcePublication[]>(
        ctx,
        `/tables/${encodeURIComponent(table.id)}/federation/publications`,
      );
      const rows = publications.flatMap((publication) =>
        (publication.mappings.length > 0 ? publication.mappings : [null]).map((mapping) => ({
          base: publication.targetBaseName,
          table: publication.targetTableName,
          revision: publication.revision,
          status: publication.revokedAt ? "revoked" : publication.status,
          sourceField: mapping?.sourceFieldName ?? "-",
          targetField: mapping?.targetFieldName ?? "-",
          publishedAt: publication.publishedAt,
        })),
      );
      printJsonOrTable(ctx, publications, rows, [
        { key: "base", label: "TARGET BASE" },
        { key: "table", label: "TARGET TABLE" },
        { key: "revision", label: "REV" },
        { key: "status", label: "STATUS" },
        { key: "sourceField", label: "SOURCE FIELD" },
        { key: "targetField", label: "TARGET FIELD" },
        { key: "publishedAt", label: "PUBLISHED" },
      ]);
    },
  }),
  command("tables combined validate", {
    summary: "Validate a Combined table configuration without saving it",
    description:
      'The body may use API UUIDs or friendly refs: {"sources":[{"base":"East","table":"Items","mappings":[{"target":"Name","source":"Title"}]}]}.',
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, body: JSON_BODY_INPUT },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      if (table.kind !== "federated") throw new Error(`Table "${table.name}" is not a Combined table.`);
      const input = await readFederatedDraftInput(ctx, base.id, table, await readJsonInput<unknown>(flags.body, "Combined table JSON"));
      const result = await readApi<FederatedValidation>(
        ctx,
        `/tables/${encodeURIComponent(table.id)}/federation/validate`,
        jsonRequest("POST", input),
      );
      if (ctx.options.output === "json") ctx.json(result);
      else if (result.valid) ctx.print("Combined table configuration is valid.");
      else for (const diagnostic of result.diagnostics) ctx.print(`${diagnostic.code}: ${diagnostic.message}`);
    },
  }),
  command("tables combined draft", {
    summary: "Replace and save a Combined table draft",
    description:
      'Use names or short ids in a friendly body: {"sources":[{"base":"East","table":"Items","mappings":[{"target":"Name","source":"Title"},{"target":"Status","source":"State","options":{"In stock":"Available"}}]}]}.',
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, body: JSON_BODY_INPUT },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      if (table.kind !== "federated") throw new Error(`Table "${table.name}" is not a Combined table.`);
      const input = await readFederatedDraftInput(ctx, base.id, table, await readJsonInput<unknown>(flags.body, "Combined table JSON"));
      const config = await readApi<FederatedTableConfig>(ctx, `/tables/${encodeURIComponent(table.id)}/federation`);
      const draft = await readApi<FederatedRevisionView>(
        ctx,
        `/tables/${encodeURIComponent(table.id)}/federation/draft`,
        jsonRequest("PUT", { ...input, draftToken: config.draft.revisionToken }),
      );
      printJsonOrMessage(
        ctx,
        draft,
        `Saved revision ${draft.revision} draft with ${draft.sources.length} sources and ${draft.diagnostics.length} diagnostics.`,
      );
    },
  }),
  command("tables combined publish", {
    summary: "Publish a valid Combined table draft",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      if (table.kind !== "federated") throw new Error(`Table "${table.name}" is not a Combined table.`);
      const revision = await readApi<FederatedRevisionView>(
        ctx,
        `/tables/${encodeURIComponent(table.id)}/federation/publish`,
        jsonRequest("POST"),
      );
      printJsonOrMessage(ctx, revision, `Published revision ${revision.revision} with ${revision.sources.length} sources.`);
    },
  }),
  command("tables combined revoke", {
    summary: "Revoke a stored source from a published Combined table",
    description:
      "Requires only admin access to the source base; target-table is the Combined table UUID shown by the publications command.",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      targetTable: flag.string({ name: "target-table", description: "Published Combined table UUID" }),
      yes: confirmFlag("Revoke this source publication"),
    },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to revoke the source publication.");
      if (!flags.targetTable) throw new Error("Pass --target-table with the published Combined table UUID.");
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const source = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "source table"));
      if (source.kind !== "stored") throw new Error(`Table "${source.name}" is not a stored source table.`);
      await readApi<null>(
        ctx,
        `/tables/${encodeURIComponent(flags.targetTable)}/federation/sources/${encodeURIComponent(source.id)}/revoke`,
        jsonRequest("POST"),
      );
      printJsonOrMessage(
        ctx,
        { revoked: source.id, targetTableId: flags.targetTable },
        `Revoked ${source.name} from Combined table ${flags.targetTable}.`,
      );
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
