import type { Hono } from "hono";
import type { hc } from "hono/client";

export type CloudCliOutputMode = "text" | "json" | "jsonl";

export type CloudCliFlagValue = string | boolean | string[];

export type CloudCliFlags = Record<string, CloudCliFlagValue>;

export type CloudCliOptions = {
  profile: string;
  server: string;
  token: string;
  output: CloudCliOutputMode;
};

export type CloudApiClient<TApi extends Hono<any, any, any>> = ReturnType<typeof hc<TApi>>;

export type CloudCliTableColumn<TRow> = {
  key: keyof TRow | string;
  label?: string;
  value?: (row: TRow) => string | number | boolean | null | undefined;
};

export type CloudCliContext = {
  args: string[];
  flags: CloudCliFlags;
  options: CloudCliOptions;
  getDefault: (key: string) => Promise<string | undefined>;
  setDefault: (key: string, value: string | undefined) => Promise<void>;
  createApiClient: <TApi extends Hono<any, any, any>>(basePath: string) => CloudApiClient<TApi>;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  readJson: <T>(response: Response) => Promise<T>;
  print: (value?: string) => void;
  /** Write a stdout chunk without adding a newline. */
  write: (value: string) => void;
  /** Print one informational or progress line to stderr. */
  error: (value: string) => void;
  json: (value: unknown) => void;
  /** Print one compact JSON value followed by a newline. */
  jsonLine: (value: unknown) => void;
  table: <TRow extends Record<string, unknown>>(rows: TRow[], columns: CloudCliTableColumn<TRow>[]) => void;
};

export type CloudCliModule = {
  name: string;
  summary: string;
  booleanFlags?: readonly string[];
  requiresCloud?: boolean;
  help?: () => string;
  run: (context: CloudCliContext) => Promise<number | void> | number | void;
};

export const defineCloudCliModule = <TModule extends CloudCliModule>(module: TModule): TModule => module;

export * from "./access";
export * from "./commands";
