import { readFile } from "node:fs/promises";
import { type CloudApiClient, type CloudCliContext, type CloudCliFlags, defineCloudCliModule } from "@valentinkolb/cloud/cli";
import type { ApiType } from "./api";
import type { NamedBlockType } from "./lib/named-blocks";
import {
  applyNoteEdits,
  type NoteEditBlockSummary,
  type NoteEditOperation,
  noteContentHash,
  summarizeNoteEditBlocks,
} from "./lib/note-edit";

type Notebook = {
  id: string;
  shortId: string;
  name: string;
  description: string | null;
  icon: string | null;
  homepageNoteId: string | null;
  homepageNoteShortId: string | null;
  scriptsEnabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type Note = {
  id: string;
  shortId: string;
  notebookId: string;
  parentId: string | null;
  title: string;
  position: number;
  hasChildren: boolean;
  yjsSnapshotAt: string | null;
  contentMd: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
};

type NoteWithContent = Note & {
  yjsSnapshot: string | null;
};

type NoteEditResponse = {
  note: Note;
  content: string;
  changed: boolean;
  beforeHash: string;
  afterHash: string;
  blocks: NoteEditBlockSummary[];
};

type NoteTreeNode = Note & {
  children: NoteTreeNode[];
};

type NoteVersion = {
  id: string;
  noteId: string;
  title: string | null;
  createdBy: string | null;
  createdAt: string;
};

type Pagination = {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
};

type Page<T> = {
  data: T[];
  pagination: Pagination;
};

const help = () => `cld notebooks

Usage:
  cld notebooks list [--q <query>] [--page <n>] [--per-page <n>]
  cld notebooks use <notebook>
  cld notebooks current
  cld notebooks get [<notebook>] [--notebook <notebook>]
  cld notebooks create <name> [--description <text>] [--icon <icon>] [--use]
  cld notebooks tree [<notebook>] [--notebook <notebook>]
  cld notebooks notes [<notebook>] [--notebook <notebook>] [--q <query>] [--parent <note>] [--page <n>] [--per-page <n>]
  cld notebooks search [<notebook>] <query> [--notebook <notebook>] [--page <n>] [--per-page <n>]
  cld notebooks read [<notebook>] <note> [--notebook <notebook>] [--note <note>] [--number-lines] [--blocks]
  cld notebooks note [<notebook>] <note> [--notebook <notebook>] [--note <note>] [--content]
  cld notebooks content [<notebook>] <note> [--notebook <notebook>] [--note <note>]
  cld notebooks edit [<notebook>] <note> [--notebook <notebook>] [--note <note>] <operation> [--file <path>|--stdin|--content <markdown>] [guards]
  cld notebooks create-note [<notebook>] <title> [--notebook <notebook>] [--parent <note>] [--content <markdown>]
  cld notebooks versions [<notebook>] <note> [--notebook <notebook>] [--note <note>] [--page <n>] [--per-page <n>]
  cld notebooks version [<notebook>] <note> <version> [--notebook <notebook>] [--note <note>] [--content]

Edit operations:
  --replace-lines <start:end>       Replace 1-based inclusive line range
  --delete-lines <start:end>        Delete 1-based inclusive line range
  --insert-before-line <line>       Insert before a 1-based line
  --insert-after-line <line>        Insert after a 1-based line
  --replace-block <name>            Replace the body after an existing @name handle
  --append-block <name>             Append markdown to an existing @name block
  --prepend-block <name>            Prepend markdown to an existing @name block
  --append                          Append markdown to the note
  --prepend                         Prepend markdown to the note
  --set-content                     Replace the complete note body

Edit options:
  --type <kind>                     Restrict named block type
  --index <n>                       Select duplicate @name block by 0-based index
  --include-handle                  Replace @name handle too for --replace-block
  --if-updated-at <timestamp>       Reject if note updatedAt changed
  --if-content-hash <sha256:...>    Reject if full content changed
  --if-block-hash <sha256:...>      Reject if selected block body changed
  --dry-run                         Apply locally and print the resulting edit metadata

Reference notes:
  Quote multi-word notebook and note names. With a default notebook, prefer --note "My Note" for unambiguous agent calls.
  For multi-word searches with a default notebook, use --q "search words" or quote the query.
`;

const NOTEBOOK_DEFAULT_KEY = "notebooks.notebook";

const stringFlag = (flags: CloudCliFlags, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.at(-1);
  }
  return undefined;
};

const booleanFlag = (flags: CloudCliFlags, ...names: string[]): boolean => names.some((name) => flags[name] === true);

const numberFlag = (flags: CloudCliFlags, name: string): number | undefined => {
  const value = stringFlag(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a 0-based integer.`);
  return parsed;
};

const paginationQuery = (flags: CloudCliFlags, extra: Record<string, string | undefined> = {}) => {
  const query: Record<string, string> = {};
  const page = stringFlag(flags, "page");
  const perPage = stringFlag(flags, "per-page", "per_page");
  if (page) query.page = page;
  if (perPage) query.per_page = perPage;
  for (const [key, value] of Object.entries(extra)) {
    if (value) query[key] = value;
  }
  return query;
};

const printJsonOrTable = <TRow extends Record<string, unknown>>(
  ctx: CloudCliContext,
  value: unknown,
  rows: TRow[],
  columns: Parameters<CloudCliContext["table"]>[1],
) => {
  if (ctx.options.output === "json") {
    ctx.json(value);
    return;
  }
  ctx.table(rows, columns);
};

const notebookRows = (items: Notebook[]) =>
  items.map((notebook) => ({
    shortId: notebook.shortId,
    id: notebook.id,
    name: notebook.name,
    updatedAt: notebook.updatedAt,
  }));

const noteRows = (items: Note[]) =>
  items.map((note) => ({
    shortId: note.shortId,
    id: note.id,
    title: note.title,
    parent: note.parentId ?? "",
    updatedAt: note.updatedAt,
  }));

const printTree = (ctx: CloudCliContext, nodes: NoteTreeNode[], depth = 0) => {
  for (const node of nodes) {
    ctx.print(`${"  ".repeat(depth)}- ${node.title} (${node.shortId})`);
    printTree(ctx, node.children, depth + 1);
  }
};

const requireArg = (args: string[], index: number, label: string): string => {
  const value = args[index];
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
};

const requireDefaultNotebookRef = async (ctx: CloudCliContext): Promise<string> => {
  const ref = await ctx.getDefault(NOTEBOOK_DEFAULT_KEY);
  if (!ref) throw new Error("Missing notebook. Pass --notebook <notebook> or run `cld notebooks use <notebook>`.");
  return ref;
};

const resolveNotebookArg = async (
  ctx: CloudCliContext,
  args: string[],
  requiredTrailingArgs: number,
): Promise<{ notebookRef: string; rest: string[] }> => {
  const flagged = stringFlag(ctx.flags, "notebook");
  if (flagged) return { notebookRef: flagged, rest: args };
  if (args.length > requiredTrailingArgs) return { notebookRef: requireArg(args, 0, "notebook"), rest: args.slice(1) };
  return { notebookRef: await requireDefaultNotebookRef(ctx), rest: args };
};

const resolveNoteCommandArgs = async (
  ctx: CloudCliContext,
  args: string[],
  requiredTrailingAfterNote = 0,
): Promise<{ notebookRef: string; noteRef: string; rest: string[] }> => {
  const flaggedNote = stringFlag(ctx.flags, "note");
  if (flaggedNote) {
    const { notebookRef, rest } = await resolveNotebookArg(ctx, args, requiredTrailingAfterNote);
    return { notebookRef, noteRef: flaggedNote, rest };
  }
  const { notebookRef, rest } = await resolveNotebookArg(ctx, args, requiredTrailingAfterNote + 1);
  return { notebookRef, noteRef: requireArg(rest, 0, "note"), rest: rest.slice(1) };
};

const parseLineRange = (value: string): { startLine: number; endLine: number } => {
  const [startRaw, endRaw] = value.split(":");
  const startLine = Number.parseInt(startRaw ?? "", 10);
  const endLine = Number.parseInt(endRaw ?? startRaw ?? "", 10);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    throw new Error(`Invalid line range "${value}". Use 1-based "start:end".`);
  }
  return { startLine, endLine };
};

const parseLineValue = (value: string, label: string): number => {
  const line = Number.parseInt(value, 10);
  if (!Number.isInteger(line) || line < 1) throw new Error(`Invalid ${label} "${value}". Use a 1-based line number.`);
  return line;
};

const readInputContent = async (ctx: CloudCliContext, required = true): Promise<string> => {
  const literal = stringFlag(ctx.flags, "content");
  const file = stringFlag(ctx.flags, "file", "f");
  const stdin = booleanFlag(ctx.flags, "stdin");
  const sources = [literal !== undefined, file !== undefined, stdin].filter(Boolean).length;
  if (sources > 1) throw new Error("Pass only one of --content, --file, or --stdin.");
  if (literal !== undefined) return literal;
  if (file) return readFile(file, "utf8");
  if (stdin) return Bun.stdin.text();
  if (required) throw new Error("Missing edit content. Pass --content, --file, or --stdin.");
  return "";
};

const formatNumberedLines = (content: string): string =>
  content
    .split("\n")
    .map((line, index) => `${String(index + 1).padStart(4, " ")} | ${line}`)
    .join("\n");

const printBlocks = (ctx: CloudCliContext, blocks: NoteEditBlockSummary[]) => {
  if (blocks.length === 0) {
    ctx.print("Blocks: none");
    return;
  }
  ctx.print("Blocks:");
  for (const block of blocks) {
    ctx.print(`  @${block.name} ${block.type} lines ${block.startLine}:${block.endLine} ${block.hash}`);
  }
};

const isHttpStatus = (error: unknown, status: number): boolean => error instanceof Error && error.message.startsWith(`${status} `);

const formatNotebookCandidates = (items: Notebook[]): string =>
  items
    .slice(0, 5)
    .map((item) => `${item.name} (${item.shortId})`)
    .join(", ");

const formatNoteCandidates = (items: Note[]): string =>
  items
    .slice(0, 5)
    .map((item) => `${item.title} (${item.shortId})`)
    .join(", ");

const resolveNotebookRef = async (ctx: CloudCliContext, api: CloudApiClient<ApiType>, ref: string): Promise<Notebook> => {
  try {
    return await ctx.readJson<Notebook>(await api[":id"].$get({ param: { id: ref } }));
  } catch (error) {
    if (!isHttpStatus(error, 404)) throw error;
    const response = await api.index.$get({ query: { q: ref, per_page: "20" } });
    const page = await ctx.readJson<Page<Notebook>>(response);
    const matches = page.data.filter((item) => item.name === ref);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new Error(`Notebook "${ref}" is ambiguous. Use one of: ${matches.map((item) => `${item.name} (${item.shortId})`).join(", ")}`);
    }
    const candidates = formatNotebookCandidates(page.data);
    throw new Error(
      candidates
        ? `Notebook "${ref}" was not found by id, short id, or exact name. Similar matches: ${candidates}`
        : `Notebook "${ref}" was not found by id, short id, or exact name.`,
    );
  }
};

const resolveNoteRef = async (ctx: CloudCliContext, api: CloudApiClient<ApiType>, notebookId: string, ref: string): Promise<Note> => {
  try {
    return await ctx.readJson<Note>(await api[":id"].notes[":noteId"].$get({ param: { id: notebookId, noteId: ref } }));
  } catch (error) {
    if (!isHttpStatus(error, 404)) throw error;
    const response = await api[":id"].notes.$get({
      param: { id: notebookId },
      query: { q: ref, per_page: "50" },
    });
    const page = await ctx.readJson<Page<Note>>(response);
    const matches = page.data.filter((item) => item.title === ref);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new Error(`Note "${ref}" is ambiguous. Use one of: ${matches.map((item) => `${item.title} (${item.shortId})`).join(", ")}`);
    }
    const candidates = formatNoteCandidates(page.data);
    throw new Error(
      candidates
        ? `Note "${ref}" was not found in notebook ${notebookId} by id, short id, or exact title. Similar matches: ${candidates}`
        : `Note "${ref}" was not found in notebook ${notebookId} by id, short id, or exact title.`,
    );
  }
};

const buildEditOperation = async (ctx: CloudCliContext): Promise<NoteEditOperation> => {
  const blockType = stringFlag(ctx.flags, "type") as NamedBlockType | undefined;
  const index = numberFlag(ctx.flags, "index");
  const blockOptions = {
    ...(blockType ? { type: blockType } : {}),
    ...(index !== undefined ? { index } : {}),
  };

  const replaceLines = stringFlag(ctx.flags, "replace-lines");
  if (replaceLines) return { kind: "replace-lines", ...parseLineRange(replaceLines), content: await readInputContent(ctx) };

  const deleteLines = stringFlag(ctx.flags, "delete-lines");
  if (deleteLines) return { kind: "delete-lines", ...parseLineRange(deleteLines) };

  const insertBeforeLine = stringFlag(ctx.flags, "insert-before-line");
  if (insertBeforeLine)
    return { kind: "insert-before-line", line: parseLineValue(insertBeforeLine, "line"), content: await readInputContent(ctx) };

  const insertAfterLine = stringFlag(ctx.flags, "insert-after-line");
  if (insertAfterLine)
    return { kind: "insert-after-line", line: parseLineValue(insertAfterLine, "line"), content: await readInputContent(ctx) };

  const replaceBlock = stringFlag(ctx.flags, "replace-block");
  if (replaceBlock) {
    return {
      kind: "replace-block",
      name: replaceBlock,
      ...blockOptions,
      includeHandle: booleanFlag(ctx.flags, "include-handle"),
      content: await readInputContent(ctx),
    };
  }

  const appendBlock = stringFlag(ctx.flags, "append-block");
  if (appendBlock) return { kind: "append-block", name: appendBlock, ...blockOptions, content: await readInputContent(ctx) };

  const prependBlock = stringFlag(ctx.flags, "prepend-block");
  if (prependBlock) return { kind: "prepend-block", name: prependBlock, ...blockOptions, content: await readInputContent(ctx) };

  if (booleanFlag(ctx.flags, "append")) return { kind: "append", content: await readInputContent(ctx) };
  if (booleanFlag(ctx.flags, "prepend")) return { kind: "prepend", content: await readInputContent(ctx) };
  if (booleanFlag(ctx.flags, "set-content")) return { kind: "set-content", content: await readInputContent(ctx) };

  throw new Error("Missing edit operation. Run `cld notebooks help` for supported edit flags.");
};

export default defineCloudCliModule({
  name: "notebooks",
  summary: "Read, search, and create notebooks through the Notebooks REST API.",
  help,
  async run(ctx) {
    const api = ctx.createApiClient<ApiType>("/api/notebooks");
    const [command, ...args] = ctx.args;

    if (!command || command === "help") {
      ctx.print(help());
      return 0;
    }

    if (command === "list") {
      const query = paginationQuery(ctx.flags, { q: stringFlag(ctx.flags, "q", "query") });
      const response = await api.index.$get({ query });
      const payload = await ctx.readJson<Page<Notebook>>(response);
      printJsonOrTable(ctx, payload, notebookRows(payload.data), [
        { key: "shortId", label: "SHORT" },
        { key: "name", label: "NAME" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
      return 0;
    }

    if (command === "use") {
      const notebookRef = requireArg(args, 0, "notebook");
      const notebook = await resolveNotebookRef(ctx, api, notebookRef);
      await ctx.setDefault(NOTEBOOK_DEFAULT_KEY, notebook.shortId);
      if (ctx.options.output === "json") ctx.json({ notebook, defaultNotebook: notebook.shortId });
      else ctx.print(`Using notebook ${notebook.name} (${notebook.shortId}).`);
      return 0;
    }

    if (command === "current") {
      const notebookRef = await ctx.getDefault(NOTEBOOK_DEFAULT_KEY);
      if (!notebookRef) throw new Error("No default notebook configured. Run `cld notebooks use <notebook>`.");
      const notebook = await resolveNotebookRef(ctx, api, notebookRef);
      if (ctx.options.output === "json") ctx.json({ notebook, defaultNotebook: notebook.shortId });
      else ctx.print(`${notebook.name} (${notebook.shortId})`);
      return 0;
    }

    if (command === "get") {
      const { notebookRef } = await resolveNotebookArg(ctx, args, 0);
      const payload = await resolveNotebookRef(ctx, api, notebookRef);
      if (ctx.options.output === "json") ctx.json(payload);
      else {
        ctx.print(`${payload.name} (${payload.shortId})`);
        if (payload.description) ctx.print(payload.description);
        ctx.print(`id: ${payload.id}`);
        ctx.print(`updated: ${payload.updatedAt}`);
      }
      return 0;
    }

    if (command === "create") {
      const name = requireArg(args, 0, "notebook name");
      const response = await api.index.$post({
        json: {
          name,
          description: stringFlag(ctx.flags, "description"),
          icon: stringFlag(ctx.flags, "icon"),
        },
      });
      const payload = await ctx.readJson<Notebook>(response);
      if (booleanFlag(ctx.flags, "use")) await ctx.setDefault(NOTEBOOK_DEFAULT_KEY, payload.shortId);
      if (ctx.options.output === "json") ctx.json(payload);
      else ctx.print(`Created ${payload.name} (${payload.shortId}).${booleanFlag(ctx.flags, "use") ? " Using it as default." : ""}`);
      return 0;
    }

    if (command === "tree") {
      const { notebookRef } = await resolveNotebookArg(ctx, args, 0);
      const notebook = await resolveNotebookRef(ctx, api, notebookRef);
      const response = await api[":id"].tree.$get({ param: { id: notebook.shortId } });
      const payload = await ctx.readJson<NoteTreeNode[]>(response);
      if (ctx.options.output === "json") ctx.json(payload);
      else printTree(ctx, payload);
      return 0;
    }

    if (command === "notes") {
      const { notebookRef } = await resolveNotebookArg(ctx, args, 0);
      const notebook = await resolveNotebookRef(ctx, api, notebookRef);
      const response = await api[":id"].notes.$get({
        param: { id: notebook.shortId },
        query: paginationQuery(ctx.flags, {
          q: stringFlag(ctx.flags, "q", "query"),
          parentId: stringFlag(ctx.flags, "parent", "parent-id"),
        }),
      });
      const payload = await ctx.readJson<Page<Note>>(response);
      printJsonOrTable(ctx, payload, noteRows(payload.data), [
        { key: "shortId", label: "SHORT" },
        { key: "title", label: "TITLE" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
      return 0;
    }

    if (command === "search") {
      const { notebookRef, rest } = await resolveNotebookArg(ctx, args, 1);
      const notebook = await resolveNotebookRef(ctx, api, notebookRef);
      const queryText = rest.join(" ").trim() || stringFlag(ctx.flags, "q", "query");
      if (!queryText) throw new Error("Missing search query.");
      const query = { ...paginationQuery(ctx.flags), q: queryText };
      const response = await api[":id"].search.$get({
        param: { id: notebook.shortId },
        query,
      });
      const payload = await ctx.readJson<Page<Note>>(response);
      printJsonOrTable(ctx, payload, noteRows(payload.data), [
        { key: "shortId", label: "SHORT" },
        { key: "title", label: "TITLE" },
        { key: "updatedAt", label: "UPDATED" },
        { key: "id", label: "ID" },
      ]);
      return 0;
    }

    if (command === "read") {
      const { notebookRef, noteRef } = await resolveNoteCommandArgs(ctx, args);
      const notebook = await resolveNotebookRef(ctx, api, notebookRef);
      const note = await resolveNoteRef(ctx, api, notebook.shortId, noteRef);
      const response = await api[":id"].notes[":noteId"].content.$get({ param: { id: notebook.shortId, noteId: note.shortId } });
      const payload = await ctx.readJson<NoteWithContent>(response);
      const content = payload.contentMd ?? "";
      const blocks = summarizeNoteEditBlocks(content);
      const result = {
        notebook,
        note: payload,
        content,
        contentHash: noteContentHash(content),
        lineCount: content.split("\n").length,
        blocks,
      };
      if (ctx.options.output === "json") {
        ctx.json(result);
        return 0;
      }
      ctx.print(`${payload.title} (${payload.shortId})`);
      ctx.print(`updated: ${payload.updatedAt}`);
      ctx.print(`hash: ${result.contentHash}`);
      if (booleanFlag(ctx.flags, "blocks")) printBlocks(ctx, blocks);
      ctx.print("");
      ctx.print(booleanFlag(ctx.flags, "number-lines", "numbered") ? formatNumberedLines(content) : content);
      return 0;
    }

    if (command === "edit") {
      const { notebookRef, noteRef } = await resolveNoteCommandArgs(ctx, args);
      const notebook = await resolveNotebookRef(ctx, api, notebookRef);
      const note = await resolveNoteRef(ctx, api, notebook.shortId, noteRef);
      const operation = await buildEditOperation(ctx);
      const request = {
        operations: [operation],
        ifUpdatedAt: stringFlag(ctx.flags, "if-updated-at"),
        ifContentHash: stringFlag(ctx.flags, "if-content-hash"),
        ifBlockHash: stringFlag(ctx.flags, "if-block-hash"),
      };

      if (booleanFlag(ctx.flags, "dry-run")) {
        const response = await api[":id"].notes[":noteId"].content.$get({ param: { id: notebook.shortId, noteId: note.shortId } });
        const payload = await ctx.readJson<NoteWithContent>(response);
        const edit = applyNoteEdits(payload.contentMd ?? "", request.operations, {
          ifContentHash: request.ifContentHash,
          ifBlockHash: request.ifBlockHash,
        });
        if (ctx.options.output === "json") ctx.json({ note: payload, ...edit });
        else {
          ctx.print(`Dry run for ${payload.title} (${payload.shortId})`);
          ctx.print(`${edit.beforeHash} -> ${edit.afterHash}`);
          printBlocks(ctx, edit.blocks);
        }
        return 0;
      }

      const response = await api[":id"].notes[":noteId"].content.$patch({
        param: { id: notebook.shortId, noteId: note.shortId },
        json: request,
      });
      const payload = await ctx.readJson<NoteEditResponse>(response);
      if (ctx.options.output === "json") ctx.json(payload);
      else {
        ctx.print(`${payload.changed ? "Edited" : "No changes"} ${payload.note.title} (${payload.note.shortId}).`);
        ctx.print(`${payload.beforeHash} -> ${payload.afterHash}`);
      }
      return 0;
    }

    if (command === "note") {
      const { notebookRef, noteRef } = await resolveNoteCommandArgs(ctx, args);
      const notebook = await resolveNotebookRef(ctx, api, notebookRef);
      const response = booleanFlag(ctx.flags, "content")
        ? await api[":id"].notes[":noteId"].content.$get({ param: { id: notebook.shortId, noteId: noteRef } })
        : await api[":id"].notes[":noteId"].$get({ param: { id: notebook.shortId, noteId: noteRef } });
      const payload = await ctx.readJson<Note | NoteWithContent>(response);
      if (ctx.options.output === "json") ctx.json(payload);
      else {
        ctx.print(`${payload.title} (${payload.shortId})`);
        ctx.print(`id: ${payload.id}`);
        if ("contentMd" in payload && payload.contentMd) {
          ctx.print("");
          ctx.print(payload.contentMd);
        }
      }
      return 0;
    }

    if (command === "content") {
      const { notebookRef, noteRef } = await resolveNoteCommandArgs(ctx, args);
      const notebook = await resolveNotebookRef(ctx, api, notebookRef);
      const response = await api[":id"].notes[":noteId"].content.$get({ param: { id: notebook.shortId, noteId: noteRef } });
      const payload = await ctx.readJson<NoteWithContent>(response);
      if (ctx.options.output === "json") ctx.json(payload);
      else ctx.print(payload.contentMd ?? "");
      return 0;
    }

    if (command === "create-note") {
      const { notebookRef, rest } = await resolveNotebookArg(ctx, args, 1);
      const title = requireArg(rest, 0, "note title");
      const notebook = await resolveNotebookRef(ctx, api, notebookRef);
      const response = await api[":id"].notes.$post({
        param: { id: notebook.shortId },
        json: {
          title,
          parentId: stringFlag(ctx.flags, "parent", "parent-id"),
          contentMd: stringFlag(ctx.flags, "content"),
        },
      });
      const payload = await ctx.readJson<Note>(response);
      if (ctx.options.output === "json") ctx.json(payload);
      else ctx.print(`Created ${payload.title} (${payload.shortId}).`);
      return 0;
    }

    if (command === "versions") {
      const { notebookRef, noteRef } = await resolveNoteCommandArgs(ctx, args);
      const notebook = await resolveNotebookRef(ctx, api, notebookRef);
      const response = await api[":id"].notes[":noteId"].versions.$get({
        param: { id: notebook.shortId, noteId: noteRef },
        query: paginationQuery(ctx.flags),
      });
      const payload = await ctx.readJson<Page<NoteVersion>>(response);
      printJsonOrTable(
        ctx,
        payload,
        payload.data.map((version) => ({ id: version.id, title: version.title ?? "", createdAt: version.createdAt })),
        [
          { key: "createdAt", label: "CREATED" },
          { key: "title", label: "TITLE" },
          { key: "id", label: "ID" },
        ],
      );
      return 0;
    }

    if (command === "version") {
      const { notebookRef, noteRef, rest } = await resolveNoteCommandArgs(ctx, args, 1);
      const versionId = requireArg(rest, 0, "version id");
      const notebook = await resolveNotebookRef(ctx, api, notebookRef);
      const response = booleanFlag(ctx.flags, "content")
        ? await api[":id"].notes[":noteId"].versions[":versionId"].content.$get({
            param: { id: notebook.shortId, noteId: noteRef, versionId },
          })
        : await api[":id"].notes[":noteId"].versions[":versionId"].$get({ param: { id: notebook.shortId, noteId: noteRef, versionId } });
      const payload = await ctx.readJson<unknown>(response);
      ctx.json(payload);
      return 0;
    }

    throw new Error(`Unknown notebooks command "${command}". Run \`cld notebooks help\`.`);
  },
});
