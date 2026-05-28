import type * as ts from "typescript";
import type { ScriptCompletionOption, ScriptTypeFile } from "./script-intelligence-protocol";

const SCRIPT_FILE = "/script.ts";
const KIT_TYPES_FILE = "/kit.d.ts";
const EXTERNAL_SHIMS_FILE = "/external-shims.d.ts";
const STDLIB_ROOT = "/node_modules/@valentinkolb/stdlib/src";

type TsModule = typeof ts;

type TsRuntime = {
  ts: TsModule;
  files: Map<string, { text: string; version: number }>;
  service: ts.LanguageService;
};

export type ScriptIntelligenceService = {
  complete: (code: string, pos: number) => ScriptCompletionOption[] | null;
};

const KIT_TYPES = `
import type {
  charts as stdCharts,
  crypto as stdCrypto,
  dates as stdDates,
  encoding as stdEncoding,
  fuzzy as stdFuzzy,
  password as stdPassword,
  text as stdText,
  timing as stdTiming,
} from "@valentinkolb/stdlib";
import type { qr as stdQr } from "@valentinkolb/stdlib/qr";
import type { files as stdFiles, images as stdImages } from "@valentinkolb/stdlib/browser";

declare global {
	type KitTableRow = Record<string, string>;
	type KitTableView = { readonly name: string; readonly columns: string[]; readonly rows: KitTableRow[] };
	type KitWritableTableView = KitTableView & { add(...cells: unknown[]): Promise<void> };
	type KitListView = { readonly name: string; readonly items: string[] };
	type KitWritableListView = KitListView & { add(...items: unknown[]): Promise<void> };
	type KitTodoItem = { readonly done: boolean; readonly content: string; readonly line: number };
	type KitTodoView = { readonly name: string; readonly items: KitTodoItem[] };
	type KitWritableTodoView = KitTodoView & { add(...items: string[]): Promise<void> };
	type KitDataView = { readonly name: string; readonly value: Record<string, unknown> };
	type KitWritableDataView = KitDataView & { set(value: Record<string, unknown>): Promise<void> };
	type KitSectionView = { readonly name: string; readonly markdown: string };
	type KitWritableSectionView = KitSectionView & { append(markdown: string): Promise<void> };
	interface KitReadableNoteBlocks {
	  table(name: string): KitTableView | undefined;
	  tables(name?: string): KitTableView[];
	  list(name: string): KitListView | undefined;
	  lists(name?: string): KitListView[];
	  todo(name: string): KitTodoView | undefined;
	  todos(name?: string): KitTodoView[];
	  data(name: string): KitDataView | undefined;
	  dataBlocks(name?: string): KitDataView[];
	  section(name: string): KitSectionView | undefined;
	  sections(name?: string): KitSectionView[];
	}
	interface KitWritableNoteBlocks {
	  table(name: string): KitWritableTableView | undefined;
	  tables(name?: string): KitWritableTableView[];
	  list(name: string): KitWritableListView | undefined;
	  lists(name?: string): KitWritableListView[];
	  todo(name: string): KitWritableTodoView | undefined;
	  todos(name?: string): KitWritableTodoView[];
	  data(name: string): KitWritableDataView | undefined;
	  dataBlocks(name?: string): KitWritableDataView[];
	  section(name: string): KitWritableSectionView | undefined;
	  sections(name?: string): KitWritableSectionView[];
	}
	type KitStdLib = {
	  text: typeof stdText;
	  dates: typeof stdDates;
	  fuzzy: typeof stdFuzzy;
	  crypto: typeof stdCrypto;
	  encoding: typeof stdEncoding;
	  charts: typeof stdCharts;
	  qr: typeof stdQr;
	  password: typeof stdPassword;
	  timing: typeof stdTiming;
	  files: typeof stdFiles;
	  images: typeof stdImages;
	  clipboard: { copy(text: string): Promise<void> };
	};
	type KitNote = KitReadableNoteBlocks & {
	  id: string;
	  title: string;
	  content: string | null;
	  tags: string[];
	  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
};
type KitAttachment = { id: string; filename: string; mimeType: string; sizeBytes: number; kind: "image" | "file"; createdAt: string };
type KitTagSummary = { tag: string; count: number };
type KitQuery = { search?: string; tags?: string[]; createdAfter?: string; createdBefore?: string; updatedAfter?: string; updatedBefore?: string; limit?: number; offset?: number };
type KitElement = HTMLElement & { show(): void };
type KitChild = KitElement | HTMLElement | string | null | false | undefined;
type KitButtonOptions = { variant?: "primary" | "secondary" | "danger"; icon?: string; disabled?: boolean };
type KitChartKind = keyof typeof stdCharts;
type KitChartOptions<K extends KitChartKind> = Omit<Parameters<(typeof stdCharts)[K]>[0], "width" | "height"> & { height?: number };

	interface KitCurrentNote extends KitWritableNoteBlocks {
	  readonly id: string;
	  readonly title: string;
	  readonly content: string;
	  readonly tags: string[];
	  readonly notebook: { id: string; name: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lockedAt: string | null;
  readonly kv: KitStateAPI;
  setTitle(title: string): Promise<void>;
  setContent(content: string): Promise<void>;
  appendContent(markdown: string): Promise<void>;
	  prependContent(markdown: string): Promise<void>;
	  insertContentAt(position: { line: number; col?: number }, markdown: string): Promise<void>;
	  replaceLine(line: number, text: string): Promise<void>;
	}
	interface KitNotesAPI {
  list(): Promise<KitNote[]>;
  get(shortId: string): Promise<KitNote | null>;
  search(query: string | KitQuery): Promise<KitNote[] & { __truncated?: boolean }>;
  searchTags(tags: string | string[], options?: { limit?: number; offset?: number }): Promise<KitNote[] & { __truncated?: boolean }>;
  create(data: { title: string; parentId?: string; content?: string }): Promise<KitNote>;
  update(shortId: string, data: { title?: string; parentId?: string | null }): Promise<KitNote>;
	  remove(shortId: string): Promise<void>;
	}
interface KitAttachmentsAPI {
  list(): Promise<KitAttachment[]>;
  listInNote(): Promise<KitAttachment[]>;
  get(shortId: string): Promise<KitAttachment | null>;
  upload(file: File | Blob, filename?: string): Promise<KitAttachment>;
  uploadFromPicker(opts?: { accept?: string; multiple?: boolean }): Promise<KitAttachment[]>;
  insertIntoContent(shortId: string): Promise<void>;
  remove(shortId: string): Promise<void>;
}
interface KitTagsAPI { list(): Promise<KitTagSummary[]>; notesForTag(tag: string): Promise<KitNote[]>; }
type KitNotebookAPI = Pick<KitNotesAPI, "list" | "get" | "search" | "searchTags" | "create" | "update" | "remove"> & {
  readonly attachments: KitAttachmentsAPI;
  readonly tags: KitTagsAPI;
  readonly localKV: KitLocalStateAPI;
};
type KitKVSetter<T> = T | ((current: T | undefined) => T);
interface KitStateAPI { get<T = unknown>(key: string): T | undefined; set<T>(key: string, value: KitKVSetter<T>): void; delete(key: string): void; keys(): string[]; observe<T = unknown>(key: string, cb: (newValue: T | undefined) => void): () => void; }
interface KitLocalStateAPI { get<T = unknown>(key: string): Promise<T | undefined>; set<T>(key: string, value: KitKVSetter<T>): Promise<void>; delete(key: string): Promise<void>; keys(): Promise<string[]>; observe<T = unknown>(key: string, cb: (newValue: T | undefined) => void): () => void; }
interface KitUI {
  row(...children: KitChild[]): KitElement;
  col(...children: KitChild[]): KitElement;
  card(...children: KitChild[]): KitElement;
  metric(label: string, value: string | number, options?: { icon?: string; hint?: string; tone?: "default" | "info" | "success" | "warning" | "danger" }): KitElement;
  divider(): KitElement;
  text(content: string): KitElement;
  heading(content: string, level?: 1 | 2 | 3 | 4 | 5 | 6): KitElement;
  md(markdown: string): KitElement;
  noteLink(note: KitNote | string, label?: string): KitElement;
  noteList(notes: KitNote[], options?: { emptyText?: string }): KitElement;
	  table(rows: unknown[][] | Record<string, unknown>[] | KitTableView, options?: { columns?: string[]; emptyText?: string }): KitElement;
  chart<K extends KitChartKind>(kind: K, options: KitChartOptions<K>): KitElement;
  button(label: string, onClick: () => void | Promise<void>, options?: KitButtonOptions): KitElement;
  html(rawHtml: string): KitElement;
  live(render: () => KitChild | KitChild[]): KitElement;
  render(...elements: KitChild[]): void;
  toast(description: string, options?: { variant?: "default" | "success" | "error"; duration?: number; iconClass?: string; title?: string }): void;
  prompt: {
    alert(message: string, options?: { title?: string; icon?: string }): Promise<void>;
    confirm(message: string, options?: { title?: string; icon?: string }): Promise<boolean>;
    text(message: string, defaultValue?: string, options?: { title?: string; placeholder?: string }): Promise<string | null>;
    form(spec: { title?: string; icon?: string; submitText?: string; cancelText?: string; fields: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  };
}
	declare const std: KitStdLib;
	declare const ui: KitUI;
	declare const nb: KitNotebookAPI;
	declare const current: KitCurrentNote;
	}
export {};
`;

const EXTERNAL_SHIMS = `
declare module "lean-qr" {
  export type Correction = unknown;
  export const correction: Record<string, Correction>;
  export function generate(...args: any[]): any;
}
declare module "lean-qr/extras/svg" {
  export function toSvgSource(...args: any[]): string;
}
`;

const normalizePath = (path: string): string => {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  const out: string[] = [];
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
};

const dirname = (path: string): string => path.slice(0, path.lastIndexOf("/")) || "/";

const completionType = (kind: string): ScriptCompletionOption["type"] => {
  if (kind.includes("method")) return "method";
  if (kind.includes("function")) return "function";
  if (kind.includes("class")) return "class";
  if (kind.includes("interface")) return "interface";
  if (kind.includes("const")) return "constant";
  if (kind.includes("let") || kind.includes("var")) return "variable";
  if (kind.includes("property")) return "property";
  if (kind.includes("keyword")) return "keyword";
  return "text";
};

const resolveModuleName = (
  moduleName: string,
  containingFile: string,
  files: Map<string, { text: string; version: number }>,
): string | null => {
  if (moduleName === "@valentinkolb/stdlib") return `${STDLIB_ROOT}/index.ts`;
  if (moduleName === "@valentinkolb/stdlib/qr") return `${STDLIB_ROOT}/qr.ts`;
  if (moduleName === "@valentinkolb/stdlib/browser") return `${STDLIB_ROOT}/browser/index.ts`;
  if (moduleName === "lean-qr" || moduleName === "lean-qr/extras/svg") return EXTERNAL_SHIMS_FILE;
  if (!moduleName.startsWith(".")) return null;

  const base = normalizePath(`${dirname(containingFile)}/${moduleName}`);
  const candidates = [base, `${base}.ts`, `${base}.d.ts`, `${base}/index.ts`, `${base}/index.d.ts`];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
};

const createRuntime = async (typeFiles: readonly ScriptTypeFile[]): Promise<TsRuntime> => {
  const tsModule = (await import("typescript")) as TsModule;
  const files = new Map<string, { text: string; version: number }>();
  for (const file of typeFiles) files.set(file.path, { text: file.text, version: 0 });
  files.set(SCRIPT_FILE, { text: "", version: 0 });
  files.set(KIT_TYPES_FILE, { text: KIT_TYPES, version: 0 });
  files.set(EXTERNAL_SHIMS_FILE, { text: EXTERNAL_SHIMS, version: 0 });

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: tsModule.ScriptTarget.ES2022,
      module: tsModule.ModuleKind.ESNext,
      moduleDetection: tsModule.ModuleDetectionKind.Force,
      noEmit: true,
      noLib: true,
      strict: false,
      skipLibCheck: true,
      allowJs: true,
      checkJs: true,
      allowImportingTsExtensions: true,
    }),
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: (fileName) => String(files.get(fileName)?.version ?? 0),
    getScriptSnapshot: (fileName) => {
      const file = files.get(fileName);
      return file ? tsModule.ScriptSnapshot.fromString(file.text) : undefined;
    },
    getCurrentDirectory: () => "/",
    getDefaultLibFileName: () => "",
    fileExists: (fileName) => files.has(normalizePath(fileName)),
    readFile: (fileName) => files.get(normalizePath(fileName))?.text,
    readDirectory: () => [],
    resolveModuleNames: (moduleNames, containingFile) =>
      moduleNames.map((moduleName) => {
        const resolved = resolveModuleName(moduleName, containingFile, files);
        return resolved ? { resolvedFileName: resolved } : undefined;
      }),
  };

  return { ts: tsModule, files, service: tsModule.createLanguageService(host) };
};

export const createScriptIntelligenceService = async (typeFiles: readonly ScriptTypeFile[]): Promise<ScriptIntelligenceService> => {
  const runtime = await createRuntime(typeFiles);

  return {
    complete: (code, pos) => {
      const current = runtime.files.get(SCRIPT_FILE)!;
      if (current.text !== code) {
        runtime.files.set(SCRIPT_FILE, { text: code, version: current.version + 1 });
      }

      const completions = runtime.service.getCompletionsAtPosition(SCRIPT_FILE, pos, {
        includeCompletionsForModuleExports: false,
        includeCompletionsWithSnippetText: false,
      });
      if (!completions) return null;

      return completions.entries.map((entry) => ({
        label: entry.name,
        type: completionType(entry.kind),
        detail: entry.kind,
      }));
    },
  };
};

export const __testing = {
  KIT_TYPES,
  EXTERNAL_SHIMS,
  normalizePath,
  resolveModuleName,
};
