import { parseDocument } from "yaml";
import { type WorkflowDefinition, WorkflowDefinitionSchema } from "../contracts";
import { validateWorkflowDefinition } from "./dsl-validator";

export type WorkflowDiagnostic = {
  message: string;
  path?: (string | number)[];
  line?: number;
  column?: number;
};

type ParseWorkflowYamlResult = { ok: true; definition: WorkflowDefinition } | { ok: false; diagnostics: WorkflowDiagnostic[] };
type NormalizeYamlValueResult = { ok: true; value: unknown } | { ok: false; diagnostics: WorkflowDiagnostic[] };

type ZodIssueLike = {
  code?: string;
  message: string;
  path: PropertyKey[];
  errors?: ZodIssueLike[][];
};

const offsetToLineColumn = (source: string, offset: number): Pick<WorkflowDiagnostic, "line" | "column"> => {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
};

const lineColumnFromYamlError = (source: string, error: unknown): Pick<WorkflowDiagnostic, "line" | "column"> => {
  const linePos = (error as { linePos?: { line?: number; col?: number }[] }).linePos;
  const first = Array.isArray(linePos) ? linePos[0] : undefined;
  if (typeof first?.line === "number") {
    return {
      line: first.line,
      column: typeof first.col === "number" ? first.col : undefined,
    };
  }
  const pos = (error as { pos?: number[] }).pos;
  const offset = Array.isArray(pos) ? pos[0] : undefined;
  if (typeof offset === "number") return offsetToLineColumn(source, offset);
  return {
    line: undefined,
    column: undefined,
  };
};

const compactPath = (path: (string | number)[]): string => (path.length === 0 ? "workflow" : path.map(String).join("."));

const issueIsGenericUnionMiss = (issue: ZodIssueLike): boolean =>
  (issue.code === "invalid_type" && issue.message.includes("received undefined")) ||
  (issue.code === "unrecognized_keys" && issue.path.length === 0);

const issueScore = (issue: ZodIssueLike): number => {
  if (issue.code === "invalid_union" && issue.errors)
    return Math.max(...issue.errors.map((branch) => branch.reduce((sum, item) => sum + issueScore(item), 0)));
  if (issueIsGenericUnionMiss(issue)) return -4;
  return 10 + issue.path.length;
};

const bestUnionBranch = (issue: ZodIssueLike): ZodIssueLike[] => {
  const branches = issue.errors ?? [];
  let best = branches[0] ?? [];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const branch of branches) {
    const score = branch.reduce((sum, item) => sum + issueScore(item), 0);
    if (score > bestScore) {
      best = branch;
      bestScore = score;
    }
  }
  return best;
};

const flattenZodIssue = (issue: ZodIssueLike, prefix: PropertyKey[] = []): WorkflowDiagnostic[] => {
  if (issue.code === "invalid_union" && issue.errors) {
    return bestUnionBranch(issue).flatMap((branchIssue) => flattenZodIssue(branchIssue, [...prefix, ...issue.path]));
  }
  if (issueIsGenericUnionMiss(issue)) return [];
  const path = [...prefix, ...issue.path] as (string | number)[];
  return [
    {
      message: `${compactPath(path)}: ${issue.message}`,
      path,
    },
  ];
};

const zodDiagnostics = (error: { issues: ZodIssueLike[] }): WorkflowDiagnostic[] => {
  const diagnostics = error.issues.flatMap((issue) => flattenZodIssue(issue));
  if (diagnostics.length > 0) return diagnostics;
  return error.issues.map((issue) => ({
    message: `${compactPath(issue.path as (string | number)[])}: ${issue.message}`,
    path: issue.path as (string | number)[],
  }));
};

const normalizeYamlValue = (source: string): NormalizeYamlValueResult => {
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });

  const parseErrors = [...document.errors, ...document.warnings];
  if (parseErrors.length > 0) {
    return {
      ok: false,
      diagnostics: parseErrors.map((error) => ({
        message: error.message,
        ...lineColumnFromYamlError(source, error),
      })),
    };
  }

  const value = document.toJS({ maxAliasCount: 50 });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      diagnostics: [{ message: "workflow must be a YAML object" }],
    };
  }
  return { ok: true, value };
};

export const parseWorkflowYaml = (source: string): ParseWorkflowYamlResult => {
  const normalized = normalizeYamlValue(source);
  if (!normalized.ok) return normalized;

  const parsed = WorkflowDefinitionSchema.safeParse(normalized.value);
  if (!parsed.success) {
    return { ok: false, diagnostics: zodDiagnostics(parsed.error) };
  }

  const diagnostics = validateWorkflowDefinition(parsed.data);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, definition: parsed.data };
};
