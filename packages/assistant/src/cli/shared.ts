import type { CloudCliContext } from "@valentinkolb/cloud/cli";

export const ASSISTANT_API = "/api/assistant";
export const SKILLS_API = "/api/ai/skills";

export const queryString = (values: Record<string, string | number | boolean | null | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
};

export const jsonRequest = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const readApi = async <T>(ctx: CloudCliContext, path: string, init?: RequestInit): Promise<T> =>
  ctx.readJson<T>(await ctx.fetch(`${ASSISTANT_API}${path}`, init));

export const readSkillsApi = async <T>(ctx: CloudCliContext, path: string, init?: RequestInit): Promise<T> =>
  ctx.readJson<T>(await ctx.fetch(`${SKILLS_API}${path}`, init));

export const printValue = (ctx: CloudCliContext, value: unknown, text?: string): void => {
  if (ctx.options.output === "json") ctx.json(value);
  else if (ctx.options.output === "jsonl") ctx.jsonLine(value);
  else if (text !== undefined) ctx.print(text);
  else ctx.print(typeof value === "string" ? value : JSON.stringify(value, null, 2));
};

export const printRows = <TRow extends Record<string, unknown>>(
  ctx: CloudCliContext,
  value: unknown,
  rows: TRow[],
  columns: Parameters<CloudCliContext["table"]>[1],
): void => {
  if (ctx.options.output === "json") ctx.json(value);
  else if (ctx.options.output === "jsonl") rows.forEach((row) => ctx.jsonLine(row));
  else if (rows.length === 0) ctx.print("No results.");
  else ctx.table(rows, columns);
};

export const requireConfirmation = (confirmed: boolean, action: string): void => {
  if (!confirmed) throw new Error(`${action} requires --yes.`);
};

export const shortId = (value: string | null | undefined): string => value?.slice(0, 8) ?? "-";

export const parseJson = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
};
