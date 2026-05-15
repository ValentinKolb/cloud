import { findNamedBlocks, type NamedBlock } from "../../../lib/named-blocks";
import type { KitContext, KitDataBlockAPI, KitListBlockAPI, KitNote, KitSectionBlockAPI, KitTableBlockAPI } from "./kit-types";

type RowInput = Record<string, unknown> | unknown[] | unknown;

const READ_MODE_WRITE_ERROR = "kit named-block writes are only available in edit mode";

const requireYText = (ctx: KitContext) => {
  if (ctx.isActive && !ctx.isActive()) throw new Error("Script run is no longer active");
  if (ctx.mode !== "edit" || !ctx.ytext) throw new Error(READ_MODE_WRITE_ERROR);
  return ctx.ytext;
};

const currentContent = (ctx: KitContext): string => (ctx.ytext ? ctx.ytext.toString() : ctx.note.content);

const isKitNote = (value: unknown): value is KitNote =>
  !!value && typeof value === "object" && typeof (value as KitNote).id === "string" && typeof (value as KitNote).title === "string";

const escapeTableCell = (value: string): string => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const normalizeTag = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
};

const normalizeMarkdownValue = (value: unknown, header?: string): string => {
  if (value === null || value === undefined) return "";
  if (isKitNote(value)) return `[${value.title}](note://${value.id})`;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) {
    const headerLooksLikeTags = header?.toLowerCase().includes("tag") ?? false;
    return value
      .map((item) => (headerLooksLikeTags && typeof item === "string" ? normalizeTag(item) : normalizeMarkdownValue(item)))
      .filter(Boolean)
      .join(" ");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value);
};

const parseScalar = (value: string): unknown => {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^["']|["']$/g, "");
};

const parseDataBlock = (src: string): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  let activeArrayKey: string | null = null;
  for (const line of src.split("\n")) {
    const arrayItem = line.match(/^\s*-\s+(.+)$/);
    if (activeArrayKey && arrayItem?.[1]) {
      (out[activeArrayKey] as unknown[]).push(parseScalar(arrayItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv?.[1]) continue;
    const key = kv[1];
    const value = kv[2] ?? "";
    if (value.trim() === "") {
      out[key] = [];
      activeArrayKey = key;
    } else {
      out[key] = parseScalar(value);
      activeArrayKey = null;
    }
  }
  return out;
};

const stringifyDataBlock = (value: Record<string, unknown>): string =>
  Object.entries(value)
    .map(([key, entry]) => {
      if (Array.isArray(entry)) {
        const items = entry.map((item) => `  - ${normalizeMarkdownValue(item)}`).join("\n");
        return `${key}:\n${items}`;
      }
      return `${key}: ${normalizeMarkdownValue(entry)}`;
    })
    .join("\n");

const splitRow = (line: string): string[] => {
  const trimmed = line.trim();
  return trimmed
    .split("|")
    .map((cell) => cell.trim())
    .filter((_, i, arr) => !((i === 0 && trimmed.startsWith("|")) || (i === arr.length - 1 && trimmed.endsWith("|"))));
};

const lineStartOffsets = (text: string): number[] => {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
};

const lineAt = (text: string, line: number): string => text.split("\n")[line] ?? "";

const tableInsertOffset = (text: string, block: NamedBlock): number => {
  const starts = lineStartOffsets(text);
  const lines = text.split("\n");
  let insertLine = block.endLine + 1;
  const lastRow = splitRow(lines[block.endLine] ?? "");
  const firstCell = (lastRow[0] ?? "").trim().toLowerCase();
  const formulaCells = lastRow.filter((cell) => cell.trim().startsWith("=")).length;
  const looksLikeFooter =
    ["total", "sum", "average", "avg", "Σ"].includes(firstCell) || (lastRow.length > 0 && formulaCells / lastRow.length > 0.5);
  if (looksLikeFooter) insertLine = block.endLine;
  return starts[insertLine] ?? text.length;
};

const rowToCells = (headers: string[], row: RowInput, rest: unknown[]): string[] => {
  const raw = rest.length > 0 ? [row, ...rest] : Array.isArray(row) ? row : [row];
  if (rest.length === 0 && raw.length === 1 && row && typeof row === "object" && !Array.isArray(row) && !isKitNote(row)) {
    const obj = row as Record<string, unknown>;
    return headers.map((header) => escapeTableCell(normalizeMarkdownValue(obj[header], header)));
  }
  return headers.map((header, index) => escapeTableCell(normalizeMarkdownValue(raw[index], header)));
};

const insertMany = (ctx: KitContext, inserts: { offset: number; text: string }[]) => {
  const ytext = requireYText(ctx);
  ytext.doc?.transact(() => {
    for (const insert of [...inserts].sort((a, b) => b.offset - a.offset)) {
      ytext.insert(insert.offset, insert.text);
    }
  });
};

const markdownAppendSeparator = (text: string, offset: number): string => {
  const before = text.slice(0, offset);
  if (before.endsWith("\n\n")) return "";
  if (before.endsWith("\n")) return "\n";
  return "\n\n";
};

export const createKitTableAPI = (ctx: KitContext, name: string): KitTableBlockAPI => ({
  add: async (...cellsInput: unknown[]) => {
    const text = currentContent(ctx);
    const blocks = findNamedBlocks(text, name, "table");
    if (blocks.length === 0) throw new Error(`kit.table("${name}"): named table not found`);
    const inserts = blocks.map((block) => {
      const headers = splitRow(lineAt(text, block.startLine));
      const [row, ...rest] = cellsInput as [RowInput, ...unknown[]];
      const cells = rowToCells(headers, row, rest);
      return { offset: tableInsertOffset(text, block), text: `| ${cells.join(" | ")} |\n` };
    });
    insertMany(ctx, inserts);
  },
});

export const createKitListAPI = (ctx: KitContext, name: string): KitListBlockAPI => ({
  add: async (...items: unknown[]) => {
    const text = currentContent(ctx);
    const blocks = findNamedBlocks(text, name, "list");
    if (blocks.length === 0) throw new Error(`kit.list("${name}"): named list not found`);
    const inserts = blocks.map((block) => {
      const offset = block.blockEnd;
      const prefix = text[offset] === "\n" || offset >= text.length ? "" : "\n";
      const body = items.map((item) => `- ${normalizeMarkdownValue(item)}`).join("\n");
      return { offset, text: `${prefix}\n${body}` };
    });
    insertMany(ctx, inserts);
  },
});

const dataContentRange = (text: string, block: NamedBlock): { from: number; to: number } => {
  const starts = lineStartOffsets(text);
  const from = starts[block.startLine + 1] ?? block.blockEnd;
  const to = starts[block.endLine] ?? block.blockEnd;
  return { from, to };
};

export const createKitDataAPI = (ctx: KitContext, name: string): KitDataBlockAPI => ({
  get: () => {
    const text = currentContent(ctx);
    const block = findNamedBlocks(text, name, "data")[0];
    if (!block) return null;
    const range = dataContentRange(text, block);
    return parseDataBlock(text.slice(range.from, range.to));
  },
  set: async (value: Record<string, unknown>) => {
    const text = currentContent(ctx);
    const blocks = findNamedBlocks(text, name, "data");
    if (blocks.length === 0) throw new Error(`kit.data("${name}"): named data block not found`);
    const ytext = requireYText(ctx);
    const next = stringifyDataBlock(value).trimEnd();
    ytext.doc?.transact(() => {
      for (const block of [...blocks].sort((a, b) => b.blockStart - a.blockStart)) {
        const range = dataContentRange(text, block);
        ytext.delete(range.from, range.to - range.from);
        ytext.insert(range.from, `${next}\n`);
      }
    });
  },
});

export const createKitSectionAPI = (ctx: KitContext, name: string): KitSectionBlockAPI => ({
  append: async (markdown: string) => {
    const text = currentContent(ctx);
    const blocks = findNamedBlocks(text, name, "section");
    if (blocks.length === 0) throw new Error(`kit.section("${name}"): named section not found`);
    const inserts = blocks.map((block) => ({
      offset: block.blockEnd,
      text: `${markdownAppendSeparator(text, block.blockEnd)}${markdown}`,
    }));
    insertMany(ctx, inserts);
  },
});
