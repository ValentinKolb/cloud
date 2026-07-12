import { arg, command, confirmFlag, flag } from "@valentinkolb/cloud/cli";
import type {
  CreateDocumentLinkResponse,
  DocumentLink,
  DocumentLinkListResponse,
  DocumentPreviewResponse,
  DocumentRunBrowseResponse,
  DocumentRunSummary,
  DocumentRunSummaryList,
  DocumentTemplate,
} from "../contracts";
import {
  DOCUMENT_TEMPLATE_REFERENCE,
  documentFolderRows,
  documentLinkRows,
  documentRunRows,
  documentTemplateFlag,
  documentTemplateRows,
  listDocumentTemplates,
  readDraftTemplateBody,
  resolveDocumentTemplate,
  resolveDocumentTemplateFromCommand,
} from "./documents-support";
import { baseFlag, resolveBaseFromCommand, resolveTable, tableArgs, tableFlag } from "./resources";
import {
  applyDefined,
  JSON_BODY_INPUT,
  jsonRequest,
  type MessageResponse,
  printJsonOrMessage,
  printJsonOrTable,
  printReference,
  queryString,
  readApi,
  readJsonInput,
  requireRestArg,
  writeApiFile,
} from "./runtime";

export const documentTemplateCommands = [
  command("document-templates reference", {
    summary: "Show document template fields, Liquid data, and examples",
    description: "Use this before creating or updating document templates from an agent.",
    examples: ["cld grids document-templates reference", "cld grids document-templates reference --json"],
    async run({ ctx }) {
      printReference(
        ctx,
        DOCUMENT_TEMPLATE_REFERENCE,
        [
          "Document templates",
          "",
          "Create PDFs from a GQL source plus Liquid HTML/CSS. Per-record templates usually filter with:",
          '  where record.id = "{{ record.id }}"',
          "",
          "Fields:",
          ...Object.entries(DOCUMENT_TEMPLATE_REFERENCE.fields).map(([key, value]) => `  ${key}: ${value}`),
          "",
          "Liquid data:",
          ...DOCUMENT_TEMPLATE_REFERENCE.liquidData.map((item) => `  ${item}`),
          "",
          "Example source:",
          `  ${DOCUMENT_TEMPLATE_REFERENCE.examples[0]!.source.replace(/\n/g, "\n  ")}`,
        ].join("\n"),
      );
    },
  }),
  command("document-templates list", {
    summary: "List document templates for a table",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      min: flag.enum(["read", "write", "admin"] as const, { default: "read", description: "Minimum effective permission" }),
      full: flag.boolean({ description: "Return full templates; requires table admin access" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const templates = await listDocumentTemplates(ctx, table.id, { full: flags.full, min: flags.min });
      printJsonOrTable(ctx, templates, documentTemplateRows(templates), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "enabled", label: "ENABLED" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("document-templates get", {
    summary: "Show a document template",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, ...documentTemplateFlag },
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      if (ctx.options.output === "json") ctx.json(template);
      else {
        ctx.print(`${template.name} (${template.shortId})`);
        if (template.description) ctx.print(template.description);
        ctx.print(`enabled: ${template.enabled ? "yes" : "no"}`);
        ctx.print(`id: ${template.id}`);
        ctx.print("");
        ctx.print(template.source);
      }
    },
  }),
  command("document-templates create", {
    summary: "Create a document template",
    description: "Run `cld grids document-templates reference` for Liquid variables, GQL source shape, and filename/number patterns.",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Template name" }),
      description: flag.string({ description: "Template description" }),
      source: flag.string({ description: "GQL source" }),
      html: flag.string({ description: "Liquid HTML body" }),
      headerHtml: flag.string({ name: "header-html", description: "Liquid header HTML" }),
      footerHtml: flag.string({ name: "footer-html", description: "Liquid footer HTML" }),
      pageCss: flag.string({ name: "page-css", description: "Page CSS" }),
      numberTemplate: flag.string({ name: "number-template", description: "Liquid document number pattern" }),
      filenameTemplate: flag.string({ name: "filename-template", description: "Liquid filename pattern" }),
      enabled: flag.boolean({ description: "Enable the template" }),
      disabled: flag.boolean({ description: "Create the template disabled" }),
    },
    examples: [
      "cld grids document-templates create Bookshop Invoices --name Invoice --source 'from table Invoices' --html '<h1>{{ document.number }}</h1>'",
      "cld grids document-templates create --base Bookshop --table Labels --body-file label-template.json",
    ],
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document template JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        source: flags.source,
        html: flags.html,
        headerHtml: flags.headerHtml,
        footerHtml: flags.footerHtml,
        pageCss: flags.pageCss,
        numberTemplate: flags.numberTemplate,
        filenameTemplate: flags.filenameTemplate,
        enabled: flags.enabled ? true : flags.disabled ? false : undefined,
      });
      if (!body.name) throw new Error("Missing document template name. Pass --name or --body JSON.");
      if (!body.source) throw new Error("Missing document template source. Pass --source or --body JSON.");
      if (!body.html) throw new Error("Missing document template HTML. Pass --html or --body JSON.");
      const template = await readApi<DocumentTemplate>(
        ctx,
        `/documents/templates/by-table/${encodeURIComponent(table.id)}`,
        jsonRequest("POST", body),
      );
      printJsonOrMessage(ctx, template, `Created document template ${template.name} (${template.shortId}).`);
    },
  }),
  command("document-templates update", {
    summary: "Update a document template",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      body: JSON_BODY_INPUT,
      name: flag.string({ description: "Template name" }),
      description: flag.string({ description: "Template description" }),
      source: flag.string({ description: "GQL source" }),
      html: flag.string({ description: "Liquid HTML body" }),
      headerHtml: flag.string({ name: "header-html", description: "Liquid header HTML" }),
      footerHtml: flag.string({ name: "footer-html", description: "Liquid footer HTML" }),
      pageCss: flag.string({ name: "page-css", description: "Page CSS" }),
      numberTemplate: flag.string({ name: "number-template", description: "Liquid document number pattern" }),
      filenameTemplate: flag.string({ name: "filename-template", description: "Liquid filename pattern" }),
      enabled: flag.boolean({ description: "Enable the template" }),
      disabled: flag.boolean({ description: "Disable the template" }),
      position: flag.int({ min: 0, description: "Template position" }),
    },
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document template update JSON", false)) ?? {};
      applyDefined(body, {
        name: flags.name,
        description: flags.description,
        source: flags.source,
        html: flags.html,
        headerHtml: flags.headerHtml,
        footerHtml: flags.footerHtml,
        pageCss: flags.pageCss,
        numberTemplate: flags.numberTemplate,
        filenameTemplate: flags.filenameTemplate,
        enabled: flags.enabled ? true : flags.disabled ? false : undefined,
        position: flags.position,
      });
      const updated = await readApi<DocumentTemplate>(
        ctx,
        `/documents/templates/${encodeURIComponent(template.id)}`,
        jsonRequest("PATCH", body),
      );
      printJsonOrMessage(ctx, updated, `Updated document template ${updated.name} (${updated.shortId}).`);
    },
  }),
  command("document-templates delete", {
    summary: "Delete a document template",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, ...documentTemplateFlag, yes: confirmFlag("Delete this document template") },
    async run({ ctx, args, flags }) {
      if (!flags.yes) throw new Error("Pass --yes to delete.");
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      await readApi<MessageResponse>(ctx, `/documents/templates/${encodeURIComponent(template.id)}`, jsonRequest("DELETE"));
      printJsonOrMessage(ctx, { deleted: template.id }, `Deleted document template ${template.name} (${template.shortId}).`);
    },
  }),
  command("document-templates preview-data", {
    summary: "Render document template preview data for one record",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      body: JSON_BODY_INPUT,
      record: flag.string({ description: "Record UUID" }),
    },
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document preview JSON", false)) ?? {};
      applyDefined(body, { recordId: flags.record });
      if (!body.recordId) throw new Error("Missing record id. Pass --record or --body JSON.");
      const preview = await readApi<DocumentPreviewResponse>(
        ctx,
        `/documents/templates/${encodeURIComponent(template.id)}/preview`,
        jsonRequest("POST", body),
      );
      if (ctx.options.output === "json") ctx.json(preview);
      else ctx.print(preview.html);
    },
  }),
  command("document-templates preview-pdf", {
    summary: "Render document template PDF preview for one record",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      body: JSON_BODY_INPUT,
      record: flag.string({ description: "Record UUID" }),
      out: flag.string({ description: "Output PDF path" }),
    },
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document preview JSON", false)) ?? {};
      applyDefined(body, { recordId: flags.record });
      if (!body.recordId) throw new Error("Missing record id. Pass --record or --body JSON.");
      await writeApiFile(ctx, `/documents/templates/${encodeURIComponent(template.id)}/preview-pdf`, jsonRequest("POST", body), flags.out);
    },
  }),
  command("document-templates preview-draft-data", {
    summary: "Render unsaved document template draft data for one record",
    description:
      "Pass a table and draft body, or also pass a saved template to use its source/html/header/footer/page CSS defaults before applying overrides.",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      body: JSON_BODY_INPUT,
      record: flag.string({ description: "Preview record UUID" }),
      source: flag.input({ name: "source", fileName: "source-file", valueLabel: "gql" }),
      html: flag.input({ name: "html", fileName: "html-file", valueLabel: "html" }),
      headerHtml: flag.input({ name: "header-html", fileName: "header-html-file", valueLabel: "html" }),
      footerHtml: flag.input({ name: "footer-html", fileName: "footer-html-file", valueLabel: "html" }),
      pageCss: flag.input({ name: "page-css", fileName: "page-css-file", valueLabel: "css" }),
      numberTemplate: flag.string({ name: "number-template", description: "Liquid document number pattern" }),
      filenameTemplate: flag.string({ name: "filename-template", description: "Liquid filename pattern" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const templateRef = flags.template ?? (flags.table ? rest[0] : rest[1]);
      const template = templateRef ? await resolveDocumentTemplate(ctx, base, table, templateRef) : null;
      const body = await readDraftTemplateBody(flags, template);
      const endpoint = template
        ? `/documents/templates/${encodeURIComponent(template.id)}/preview-data-draft`
        : `/documents/templates/by-table/${encodeURIComponent(table.id)}/preview-data-draft`;
      const preview = await readApi<DocumentPreviewResponse>(ctx, endpoint, jsonRequest("POST", body));
      if (ctx.options.output === "json") ctx.json(preview);
      else ctx.print(preview.html);
    },
  }),
  command("document-templates preview-draft-pdf", {
    summary: "Render an unsaved document template draft PDF for one record",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      body: JSON_BODY_INPUT,
      record: flag.string({ description: "Preview record UUID" }),
      source: flag.input({ name: "source", fileName: "source-file", valueLabel: "gql" }),
      html: flag.input({ name: "html", fileName: "html-file", valueLabel: "html" }),
      headerHtml: flag.input({ name: "header-html", fileName: "header-html-file", valueLabel: "html" }),
      footerHtml: flag.input({ name: "footer-html", fileName: "footer-html-file", valueLabel: "html" }),
      pageCss: flag.input({ name: "page-css", fileName: "page-css-file", valueLabel: "css" }),
      numberTemplate: flag.string({ name: "number-template", description: "Liquid document number pattern" }),
      filenameTemplate: flag.string({ name: "filename-template", description: "Liquid filename pattern" }),
      out: flag.string({ description: "Output PDF path" }),
    },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table ? 0 : 1);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const templateRef = flags.template ?? (flags.table ? rest[0] : rest[1]);
      const template = templateRef ? await resolveDocumentTemplate(ctx, base, table, templateRef) : null;
      const body = await readDraftTemplateBody(flags, template);
      const endpoint = template
        ? `/documents/templates/${encodeURIComponent(template.id)}/preview-draft`
        : `/documents/templates/by-table/${encodeURIComponent(table.id)}/preview-draft`;
      await writeApiFile(ctx, endpoint, jsonRequest("POST", body), flags.out);
    },
  }),
];

export const documentCommands = [
  command("documents list", {
    summary: "List generated documents for a document template",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      q: flag.string({ aliases: ["query"], description: "Search generated document filename, number, or tags" }),
      tag: flag.stringList({ description: "Tag filter. Repeatable." }),
      cursor: flag.string({ description: "Pagination cursor" }),
      limit: flag.int({ min: 1, max: 500, description: "Maximum documents" }),
      offset: flag.int({ min: 0, description: "Offset for offset-based pages" }),
    },
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      const payload = await readApi<DocumentRunSummaryList>(
        ctx,
        `/documents/runs/by-template/${encodeURIComponent(template.id)}${queryString({
          q: flags.q,
          tags: flags.tag.join(","),
          cursor: flags.cursor,
          limit: flags.limit,
          offset: flags.offset,
        })}`,
      );
      printJsonOrTable(ctx, payload, documentRunRows(payload.items), [
        { key: "shortId", label: "SHORT" },
        { key: "number", label: "NUMBER" },
        { key: "filename", label: "FILENAME" },
        { key: "tags", label: "TAGS" },
        { key: "generatedAt", label: "GENERATED" },
        { key: "id", label: "ID" },
      ]);
      if (ctx.options.output !== "json" && payload.nextCursor) ctx.print(`next cursor: ${payload.nextCursor}`);
    },
  }),
  command("documents browse", {
    summary: "Browse generated documents as list rows or year/month folders",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      mode: flag.enum(["list", "folders"] as const, { default: "folders", description: "Browse mode" }),
      path: flag.string({ description: "Folder path such as 2026/07" }),
      q: flag.string({ aliases: ["query"], description: "Search generated document filename, number, or tags" }),
      tag: flag.stringList({ description: "Tag filter. Repeatable." }),
      cursor: flag.string({ description: "Pagination cursor" }),
      limit: flag.int({ min: 1, max: 500, description: "Maximum documents or folders" }),
    },
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      const payload = await readApi<DocumentRunBrowseResponse>(
        ctx,
        `/documents/runs/by-template/${encodeURIComponent(template.id)}/browse${queryString({
          mode: flags.mode,
          path: flags.path,
          q: flags.q,
          tags: flags.tag.join(","),
          cursor: flags.cursor,
          limit: flags.limit,
        })}`,
      );
      if (ctx.options.output === "json") {
        ctx.json(payload);
        return;
      }
      if (payload.folders.length > 0) {
        ctx.table(documentFolderRows(payload.folders), [
          { key: "kind", label: "KIND" },
          { key: "label", label: "FOLDER" },
          { key: "count", label: "COUNT" },
          { key: "path", label: "PATH" },
        ]);
      }
      if (payload.items.length > 0) {
        ctx.table(documentRunRows(payload.items), [
          { key: "shortId", label: "SHORT" },
          { key: "number", label: "NUMBER" },
          { key: "filename", label: "FILENAME" },
          { key: "tags", label: "TAGS" },
          { key: "generatedAt", label: "GENERATED" },
          { key: "id", label: "ID" },
        ]);
      }
      if (payload.folders.length === 0 && payload.items.length === 0) ctx.print("No documents.");
      if (payload.nextCursor) ctx.print(`next cursor: ${payload.nextCursor}`);
    },
  }),
  command("documents by-record", {
    summary: "List generated documents for one record",
    args: tableArgs,
    flags: { ...baseFlag, ...tableFlag, record: flag.string({ description: "Record UUID" }) },
    async run({ ctx, args, flags }) {
      const { base, rest } = await resolveBaseFromCommand(ctx, args.args, flags.table && flags.record ? 0 : 2);
      const table = await resolveTable(ctx, base.id, flags.table ?? requireRestArg(rest, 0, "table"));
      const recordId = flags.record ?? requireRestArg(flags.table ? rest : rest.slice(1), 0, "record");
      const payload = await readApi<DocumentRunSummaryList>(
        ctx,
        `/documents/runs/by-record/${encodeURIComponent(table.id)}/${encodeURIComponent(recordId)}`,
      );
      printJsonOrTable(ctx, payload, documentRunRows(payload.items), [
        { key: "shortId", label: "SHORT" },
        { key: "number", label: "NUMBER" },
        { key: "filename", label: "FILENAME" },
        { key: "tags", label: "TAGS" },
        { key: "generatedAt", label: "GENERATED" },
        { key: "id", label: "ID" },
      ]);
    },
  }),
  command("documents generate", {
    summary: "Generate and store a PDF document run",
    args: tableArgs,
    flags: {
      ...baseFlag,
      ...tableFlag,
      ...documentTemplateFlag,
      body: JSON_BODY_INPUT,
      record: flag.string({ description: "Record UUID" }),
      filename: flag.string({ description: "Optional generated filename override" }),
      tag: flag.stringList({ description: "Generated document tag. Repeatable." }),
      out: flag.string({ description: "Output PDF path" }),
    },
    examples: [
      "cld grids documents generate Bookshop Invoices Invoice --record <record-uuid> --out invoice.pdf",
      'cld grids documents generate --base Bookshop --table Labels --template ItemLabel --body \'{"recordId":"...","tags":["printed"]}\' --out label.pdf',
    ],
    async run({ ctx, args, flags }) {
      const { template } = await resolveDocumentTemplateFromCommand(ctx, args.args, flags);
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document generation JSON", false)) ?? {};
      applyDefined(body, {
        recordId: flags.record,
        filename: flags.filename,
        tags: flags.tag.length > 0 ? flags.tag : undefined,
      });
      if (!body.recordId) throw new Error("Missing record id. Pass --record or --body JSON.");
      await writeApiFile(ctx, `/documents/templates/${encodeURIComponent(template.id)}/generate`, jsonRequest("POST", body), flags.out);
    },
  }),
  command("documents update", {
    summary: "Update generated document metadata",
    args: { run: arg.required({ description: "Generated document run UUID" }) },
    flags: {
      body: JSON_BODY_INPUT,
      filename: flag.string({ description: "Generated filename" }),
      tag: flag.stringList({ description: "Replace tags. Repeatable." }),
    },
    async run({ ctx, args, flags }) {
      const body = (await readJsonInput<Record<string, unknown>>(flags.body, "document metadata JSON", false)) ?? {};
      applyDefined(body, {
        filename: flags.filename,
        tags: flags.tag.length > 0 ? flags.tag : undefined,
      });
      const updated = await readApi<DocumentRunSummary>(ctx, `/documents/runs/${encodeURIComponent(args.run)}`, jsonRequest("PATCH", body));
      printJsonOrMessage(ctx, updated, `Updated document ${updated.filename}.`);
    },
  }),
  command("documents download", {
    summary: "Download a generated document PDF from its stored snapshot",
    args: { run: arg.required({ description: "Generated document run UUID" }) },
    flags: { out: flag.string({ description: "Output PDF path" }) },
    async run({ ctx, args, flags }) {
      await writeApiFile(ctx, `/documents/runs/${encodeURIComponent(args.run)}/download`, undefined, flags.out);
    },
  }),
  command("documents links list", {
    summary: "List public links for a generated document",
    args: { run: arg.required({ description: "Generated document run UUID" }) },
    async run({ ctx, args }) {
      const payload = await readApi<DocumentLinkListResponse>(ctx, `/documents/runs/${encodeURIComponent(args.run)}/links`);
      printJsonOrTable(ctx, payload, documentLinkRows(payload.items), [
        { key: "id", label: "ID" },
        { key: "expiresAt", label: "EXPIRES" },
        { key: "revokedAt", label: "REVOKED" },
        { key: "accessCount", label: "HITS" },
        { key: "comment", label: "COMMENT" },
      ]);
    },
  }),
  command("documents links create", {
    summary: "Create an expiring public link for a generated document",
    args: { run: arg.required({ description: "Generated document run UUID" }) },
    flags: {
      expiresIn: flag.enum(["1d", "7d", "30d", "90d"] as const, {
        name: "expires-in",
        default: "30d",
        description: "Public link lifetime",
      }),
      comment: flag.string({ description: "Optional link comment" }),
    },
    async run({ ctx, args, flags }) {
      const payload = await readApi<CreateDocumentLinkResponse>(
        ctx,
        `/documents/runs/${encodeURIComponent(args.run)}/links`,
        jsonRequest("POST", { expiresIn: flags.expiresIn, comment: flags.comment }),
      );
      if (ctx.options.output === "json") ctx.json(payload);
      else ctx.print(payload.url);
    },
  }),
  command("documents links revoke", {
    summary: "Revoke a public document link",
    args: { link: arg.required({ description: "Document link UUID" }) },
    async run({ ctx, args }) {
      const link = await readApi<DocumentLink>(ctx, `/documents/links/${encodeURIComponent(args.link)}/revoke`, jsonRequest("POST"));
      printJsonOrMessage(ctx, link, `Revoked document link ${link.id}.`);
    },
  }),
];
