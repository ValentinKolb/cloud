import { z } from "zod";
import { aiFileStore, guessAiMediaType, normalizeAiFilePath } from "./files-store";
import { defineAiTool } from "./tools";

const FILE_READ_MAX_BYTES = 64 * 1024;
const FILE_WRITE_MAX_BYTES = 100 * 1024;

const toolPath = (value: string, access: "read" | "write"): string => {
  const candidate = value.startsWith("/") ? value : `/files/${value}`;
  const path = normalizeAiFilePath(candidate);
  const readable = path === "/files" || path?.startsWith("/files/") || path === "/input" || path?.startsWith("/input/");
  const writable = path?.startsWith("/files/");
  if (!path || (access === "read" ? !readable : !writable)) {
    throw new Error(access === "read" ? "Use a path under /files or /input." : "Use a file path under /files.");
  }
  return path;
};

const isTextMediaType = (mediaType: string): boolean =>
  mediaType.startsWith("text/") ||
  ["application/json", "application/ld+json", "application/yaml", "application/xml", "image/svg+xml"].includes(mediaType);

const textMediaTypeForPath = (path: string): string => {
  const mediaType = guessAiMediaType(path);
  return isTextMediaType(mediaType) ? mediaType : "text/plain";
};

const conversationId = (value: string | undefined, tool: string): string => {
  if (!value) throw new Error(`The ${tool} tool needs a conversation context.`);
  return value;
};

export const CloudAiListFilesInputSchema = z.object({
  path: z.string().trim().min(1).default("/").describe("Directory or path prefix. Use / for all conversation files."),
});
export const CloudAiListFilesOutputSchema = z.object({
  files: z.array(z.object({ path: z.string(), size: z.number(), mediaType: z.string(), updatedAt: z.string() })),
  truncated: z.boolean(),
});

export const createCloudAiListFilesTool = () =>
  defineAiTool({
    name: "list_files",
    description: "List persistent conversation files under /files and uploaded files under /input.",
    inputSchema: CloudAiListFilesInputSchema,
    outputSchema: CloudAiListFilesOutputSchema,
    approval: "never",
    promptHint: "list conversation files before reading an upload or locating a generated result.",
  }).server(async (input, ctx) => {
    const prefix = input.path === "/" ? "/" : toolPath(input.path, "read");
    const files = await aiFileStore.list({ conversationId: conversationId(ctx.conversationId, "list_files"), prefix });
    return { files: files.slice(0, 200), truncated: files.length > 200 };
  });

export const CloudAiReadFileInputSchema = z.object({
  path: z.string().trim().min(1).describe("File under /files or /input."),
  offset: z.number().int().min(0).default(0).describe("Byte offset. Continue with nextOffset from the previous result."),
  length: z
    .number()
    .int()
    .min(4)
    .max(FILE_READ_MAX_BYTES)
    .default(16 * 1024)
    .describe("Maximum bytes to read (minimum 4 so one UTF-8 character always fits)."),
});
export const CloudAiReadFileOutputSchema = z.object({
  path: z.string(),
  mediaType: z.string(),
  content: z.string(),
  offset: z.number(),
  nextOffset: z.number(),
  eof: z.boolean(),
});

export const createCloudAiReadFileTool = () =>
  defineAiTool({
    name: "read_file",
    description:
      "Read a UTF-8 text conversation file in bounded byte slices. Binary files are not returned as model context. Continue large files with nextOffset.",
    inputSchema: CloudAiReadFileInputSchema,
    outputSchema: CloudAiReadFileOutputSchema,
    approval: "never",
    promptHint: "read text uploads or generated files in bounded slices; continue large files with nextOffset.",
  }).server(async (input, ctx) => {
    const id = conversationId(ctx.conversationId, "read_file");
    const path = toolPath(input.path, "read");
    const stat = await aiFileStore.stat({ conversationId: id, path });
    if (!stat) throw new Error(`No such file: ${path}`);
    if (!isTextMediaType(stat.mediaType)) throw new Error(`Cannot read binary file ${path} (${stat.mediaType}) as text.`);
    if (input.offset > stat.size) throw new Error(`Offset ${input.offset} is past the end of ${path} (${stat.size} bytes).`);

    const requestedEnd = Math.min(stat.size, input.offset + input.length);
    const bytes = await aiFileStore.readSlice({ conversationId: id, path, offset: input.offset, length: requestedEnd - input.offset });
    if (!bytes) throw new Error(`No such file: ${path}`);

    let end = -1;
    let content = "";
    for (let trim = 0; trim <= Math.min(3, bytes.byteLength); trim += 1) {
      try {
        const candidateEnd = bytes.byteLength - trim;
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, candidateEnd));
        end = candidateEnd;
        break;
      } catch {
        // A bounded slice can end inside one UTF-8 code point (at most 3 bytes).
      }
    }
    if (end < 0) throw new Error(`File ${path} is not valid UTF-8 at byte ${input.offset}.`);
    if (end === 0 && requestedEnd > input.offset) throw new Error(`Offset ${input.offset} is not on a UTF-8 character boundary.`);

    const nextOffset = input.offset + end;
    return { path, mediaType: stat.mediaType, content, offset: input.offset, nextOffset, eof: nextOffset >= stat.size };
  });

export const CloudAiWriteFileInputSchema = z.object({
  path: z.string().trim().min(1).describe("Destination file under /files."),
  content: z.string().max(FILE_WRITE_MAX_BYTES).describe("UTF-8 text to write."),
  mode: z.enum(["overwrite", "append"]).default("overwrite"),
});
export const CloudAiWriteFileOutputSchema = z.object({ path: z.string(), size: z.number(), mediaType: z.string() });

export const createCloudAiWriteFileTool = () =>
  defineAiTool({
    name: "write_file",
    description:
      "Write or append UTF-8 text to a persistent conversation file under /files. Use present afterwards when the user should receive the file.",
    inputSchema: CloudAiWriteFileInputSchema,
    outputSchema: CloudAiWriteFileOutputSchema,
    approval: "never",
    promptHint: "write a text result under /files; use append for bounded incremental output and present to deliver it.",
  }).server(async (input, ctx) => {
    const id = conversationId(ctx.conversationId, "write_file");
    const path = toolPath(input.path, "write");
    const bytes = new TextEncoder().encode(input.content);
    if (bytes.byteLength > FILE_WRITE_MAX_BYTES) throw new Error(`One write is limited to ${FILE_WRITE_MAX_BYTES} bytes.`);
    const mediaType = textMediaTypeForPath(path);
    if (input.mode === "append") {
      await aiFileStore.append({ conversationId: id, path, bytes, mediaType });
    } else {
      await aiFileStore.write({ conversationId: id, path, bytes, mediaType });
    }
    const stat = await aiFileStore.stat({ conversationId: id, path });
    if (!stat) throw new Error(`Failed to write ${path}.`);
    return { path: stat.path, size: stat.size, mediaType: stat.mediaType };
  });

export const CloudAiPresentInputSchema = z.object({
  path: z.string().trim().min(1).describe("File under /files or /input."),
  title: z.string().trim().min(1).max(120).optional(),
});
export const CloudAiPresentOutputSchema = z.object({ path: z.string(), size: z.number(), mediaType: z.string() });

export const createCloudAiPresentTool = () =>
  defineAiTool({
    name: "present",
    description: "Present a conversation file to the user as an openable and downloadable chat attachment.",
    inputSchema: CloudAiPresentInputSchema,
    outputSchema: CloudAiPresentOutputSchema,
    approval: "never",
    promptHint: "hand a produced or uploaded file to the user as an openable download card.",
  }).server(async (input, ctx) => {
    const id = conversationId(ctx.conversationId, "present");
    const path = toolPath(input.path, "read");
    const stat = await aiFileStore.stat({ conversationId: id, path });
    if (!stat) throw new Error(`No such file: ${path}`);
    return { path: stat.path, size: stat.size, mediaType: stat.mediaType };
  });

type MathToken = { kind: "number"; value: number } | { kind: "ident"; name: string } | { kind: "op"; op: string };

const tokenizeMath = (input: string): MathToken[] => {
  const tokens: MathToken[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const number = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(input.slice(index));
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const identifier = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(input.slice(index));
    if (identifier) {
      tokens.push({ kind: "ident", name: identifier[0].toLowerCase() });
      index += identifier[0].length;
      continue;
    }
    if ("+-*/%^(),".includes(char)) {
      tokens.push({ kind: "op", op: char });
      index += 1;
      continue;
    }
    throw new Error(`Unexpected character "${char}".`);
  }
  return tokens;
};

const MATH_CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };
type MathFunction = { run: (...args: number[]) => number; minArgs: number; maxArgs?: number };
const MATH_FUNCTIONS: Record<string, MathFunction> = {
  sqrt: { run: Math.sqrt, minArgs: 1, maxArgs: 1 },
  abs: { run: Math.abs, minArgs: 1, maxArgs: 1 },
  floor: { run: Math.floor, minArgs: 1, maxArgs: 1 },
  ceil: { run: Math.ceil, minArgs: 1, maxArgs: 1 },
  round: {
    run: (value, digits = 0) => {
      if (!Number.isInteger(digits) || Math.abs(digits) > 100) throw new Error("round digits must be an integer between -100 and 100.");
      const factor = 10 ** digits;
      return Math.round(value * factor) / factor;
    },
    minArgs: 1,
    maxArgs: 2,
  },
  min: { run: Math.min, minArgs: 1 },
  max: { run: Math.max, minArgs: 1 },
  pow: { run: (base, exponent) => base ** exponent, minArgs: 2, maxArgs: 2 },
  sin: { run: Math.sin, minArgs: 1, maxArgs: 1 },
  cos: { run: Math.cos, minArgs: 1, maxArgs: 1 },
  tan: { run: Math.tan, minArgs: 1, maxArgs: 1 },
  log: { run: Math.log10, minArgs: 1, maxArgs: 1 },
  ln: { run: Math.log, minArgs: 1, maxArgs: 1 },
  exp: { run: Math.exp, minArgs: 1, maxArgs: 1 },
};

export const evaluateAiMath = (input: string): number => {
  const tokens = tokenizeMath(input);
  let position = 0;
  const peek = () => tokens[position];
  const nextOp = (...ops: string[]): string | null => {
    const token = peek();
    if (token?.kind !== "op" || !ops.includes(token.op)) return null;
    position += 1;
    return token.op;
  };
  const primary = (): number => {
    const token = peek();
    if (!token) throw new Error("Unexpected end of expression.");
    if (token.kind === "number") {
      position += 1;
      return token.value;
    }
    if (token.kind === "ident") {
      position += 1;
      if (nextOp("(")) {
        const args = [expression()];
        while (nextOp(",")) args.push(expression());
        if (!nextOp(")")) throw new Error(`Missing ")" after ${token.name}(...).`);
        const fn = MATH_FUNCTIONS[token.name];
        if (!fn) throw new Error(`Unknown function "${token.name}".`);
        if (args.length < fn.minArgs || (fn.maxArgs !== undefined && args.length > fn.maxArgs)) {
          const expected =
            fn.maxArgs === undefined
              ? `at least ${fn.minArgs}`
              : fn.minArgs === fn.maxArgs
                ? `${fn.minArgs}`
                : `${fn.minArgs}-${fn.maxArgs}`;
          throw new Error(`${token.name}(...) expects ${expected} argument(s).`);
        }
        return fn.run(...args);
      }
      const constant = MATH_CONSTANTS[token.name];
      if (constant === undefined) throw new Error(`Unknown constant "${token.name}".`);
      return constant;
    }
    if (nextOp("(")) {
      const value = expression();
      if (!nextOp(")")) throw new Error('Missing ")".');
      return value;
    }
    throw new Error(`Unexpected "${token.op}".`);
  };
  const power = (): number => {
    const base = primary();
    return nextOp("^") ? base ** unary() : base;
  };
  const unary = (): number => {
    if (nextOp("-")) return -unary();
    if (nextOp("+")) return unary();
    return power();
  };
  const term = (): number => {
    let value = unary();
    for (let op = nextOp("*", "/", "%"); op; op = nextOp("*", "/", "%")) {
      const right = unary();
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  };
  const expression = (): number => {
    let value = term();
    for (let op = nextOp("+", "-"); op; op = nextOp("+", "-")) {
      const right = term();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  const result = expression();
  if (position !== tokens.length) throw new Error("Unexpected trailing input.");
  if (!Number.isFinite(result)) throw new Error("The result is not a finite number.");
  return result;
};

const dateInBerlin = (): string => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

const utcDate = (year: number, month: number, day: number): Date => {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
};

const parseIsoDate = (value: string): { year: number; month: number; day: number } => {
  const normalized = ["today", "now"].includes(value.trim().toLowerCase()) ? dateInBerlin() : value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new Error('Use an ISO date (YYYY-MM-DD), "today", or "now".');
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  if (year < 1) throw new Error(`Invalid date "${normalized}".`);
  const date = utcDate(year, month, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Invalid date "${normalized}".`);
  }
  return { year, month, day };
};

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
const daysInMonth = (year: number, month: number): number => utcDate(year, month + 1, 0).getUTCDate();

const checkedIsoDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1 || year > 9999) throw new Error("Date result is outside 0001-01-01 to 9999-12-31.");
  return isoDate(date);
};

export const evaluateAiDate = (input: string): string => {
  const match = /^(.+?)(?:\s*([+-])\s*(\d+)\s+(days?|weeks?|months?|years?))?$/i.exec(input.trim());
  if (!match) throw new Error("Invalid date calculation.");
  const base = parseIsoDate(match[1]!);
  if (!match[2]) return checkedIsoDate(utcDate(base.year, base.month, base.day));
  const amount = Number(match[3]) * (match[2] === "+" ? 1 : -1);
  if (!Number.isSafeInteger(amount)) throw new Error("Date offset is too large.");
  const unit = match[4]!.toLowerCase().replace(/s$/, "");

  if (unit === "day" || unit === "week") {
    const date = utcDate(base.year, base.month, base.day);
    date.setUTCDate(date.getUTCDate() + amount * (unit === "week" ? 7 : 1));
    return checkedIsoDate(date);
  }

  const monthDelta = unit === "year" ? amount * 12 : amount;
  const monthIndex = base.year * 12 + base.month - 1 + monthDelta;
  const year = Math.floor(monthIndex / 12);
  const month = (((monthIndex % 12) + 12) % 12) + 1;
  return checkedIsoDate(utcDate(year, month, Math.min(base.day, daysInMonth(year, month))));
};

export const CloudAiCalculateInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("math"), expression: z.string().trim().min(1).max(500) }),
  z.object({ kind: z.literal("date"), expression: z.string().trim().min(1).max(100) }),
]);
export const CloudAiCalculateOutputSchema = z.object({ result: z.string() });

export const createCloudAiCalculateTool = () =>
  defineAiTool({
    name: "calculate",
    description:
      "Evaluate floating-point arithmetic or deterministic ISO-date offsets without executing code. Math supports + - * / % ^, parentheses, common functions, pi, and e. Date supports YYYY-MM-DD or today plus/minus days, weeks, months, or years.",
    inputSchema: CloudAiCalculateInputSchema,
    outputSchema: CloudAiCalculateOutputSchema,
    approval: "never",
    promptHint: "calculate arithmetic or deterministic ISO-date offsets instead of estimating mentally.",
  }).server(async (input) => ({
    result: input.kind === "math" ? String(evaluateAiMath(input.expression)) : evaluateAiDate(input.expression),
  }));
