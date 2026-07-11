import { type CliInputFlagValue, type CloudCliContext, readCliInput } from "@valentinkolb/cloud/cli";

const apiPath = (path: string) => `/api/pulse${path}`;

export const queryString = (params: Record<string, string | number | boolean | null | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
};

export const jsonRequest = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const readApi = async <T>(ctx: CloudCliContext, path: string, init?: RequestInit): Promise<T> =>
  ctx.readJson<T>(await ctx.fetch(apiPath(path), init));

export const readTextInput = async (input: CliInputFlagValue, label: string, maxLength?: number): Promise<string> => {
  const value = (await readCliInput(input, { label, required: true, trimFinalNewline: true }))?.trim();
  if (!value) throw new Error(`Missing ${label}.`);
  if (maxLength !== undefined && value.length > maxLength) throw new Error(`${label} must be at most ${maxLength} characters.`);
  return value;
};

export const readJsonInput = async <T>(input: CliInputFlagValue, label: string): Promise<T> => {
  const text = await readTextInput(input, label);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${message}`);
  }
};

export const printJsonOrTable = <TRow extends Record<string, unknown>>(
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

export const printMessage = (ctx: CloudCliContext, value: unknown, message: string) => {
  if (ctx.options.output === "json") ctx.json(value);
  else ctx.print(message);
};

export const exactMatch = <T>(items: T[], ref: string, fields: ((item: T) => string | null | undefined)[], label: string): T => {
  const matches = items.filter((item) => fields.some((field) => field(item) === ref));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`Ambiguous ${label} "${ref}". Use an ID.`);
  const foldedMatches = items.filter((item) => fields.some((field) => (field(item) ?? "").toLowerCase() === ref.toLowerCase()));
  if (foldedMatches.length === 1) return foldedMatches[0]!;
  if (foldedMatches.length > 1) throw new Error(`Ambiguous ${label} "${ref}". Use an ID.`);
  const candidates = items
    .filter((item) => fields.some((field) => (field(item) ?? "").toLowerCase().includes(ref.toLowerCase())))
    .slice(0, 5)
    .map((item) =>
      fields
        .map((field) => field(item))
        .filter(Boolean)
        .join(" / "),
    )
    .join(", ");
  throw new Error(`Unknown ${label} "${ref}".${candidates ? ` Candidates: ${candidates}.` : ""}`);
};

export const compactId = (value: string | null | undefined): string => (value ? value.slice(0, 8) : "-");
export const yesNo = (value: boolean): string => (value ? "yes" : "no");
export const formatDate = (value: string | null | undefined): string => (value ? value : "-");
export const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};
