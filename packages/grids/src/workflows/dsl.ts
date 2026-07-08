import { parseDocument } from "yaml";
import { type WorkflowDefinition, WorkflowDefinitionSchema, type WorkflowInput, type WorkflowInputType } from "../contracts";

export type WorkflowDiagnostic = {
  message: string;
  path?: (string | number)[];
  line?: number;
  column?: number;
};

export type ParseWorkflowYamlResult = { ok: true; definition: WorkflowDefinition } | { ok: false; diagnostics: WorkflowDiagnostic[] };
type NormalizeYamlValueResult = { ok: true; value: unknown } | { ok: false; diagnostics: WorkflowDiagnostic[] };

type RefKind = WorkflowInputType | "record" | "document" | "documentLink" | "email";
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

const inputKind = (inputs: Record<string, WorkflowInput>, name: string): WorkflowInputType | null => inputs[name]?.type ?? null;

const resolveRefKind = (ref: unknown, inputs: Record<string, WorkflowInput>, locals: Map<string, RefKind>): RefKind | null => {
  if (typeof ref !== "string") return null;
  const parts = ref.split(".");
  const first = parts[0];
  if (!first) return null;
  if (first === "inputs") {
    const inputName = parts[1];
    return inputName ? inputKind(inputs, inputName) : null;
  }
  return locals.get(first) ?? null;
};

const expectRefKind = (params: {
  ref: unknown;
  expected: RefKind;
  inputs: Record<string, WorkflowInput>;
  locals: Map<string, RefKind>;
  path: (string | number)[];
  diagnostics: WorkflowDiagnostic[];
  label: string;
}): void => {
  const actual = resolveRefKind(params.ref, params.inputs, params.locals);
  if (actual === params.expected) return;
  params.diagnostics.push({
    path: params.path,
    message:
      actual === null
        ? `${compactPath(params.path)}: ${params.label} must reference a known ${params.expected}`
        : `${compactPath(params.path)}: ${params.label} references ${actual}, expected ${params.expected}`,
  });
};

const validateTriggers = (definition: WorkflowDefinition, diagnostics: WorkflowDiagnostic[]): void => {
  const inputs = definition.inputs ?? {};
  const scannerInput = definition.triggers.scanner?.input;
  if (scannerInput) {
    const input = inputs[scannerInput];
    if (!input) {
      diagnostics.push({ path: ["triggers", "scanner", "input"], message: `triggers.scanner.input: unknown input "${scannerInput}"` });
    } else if (input.type !== "record") {
      diagnostics.push({ path: ["triggers", "scanner", "input"], message: "triggers.scanner.input must reference a record input" });
    }
    const resolve = definition.triggers.scanner?.resolve;
    if (resolve?.by === "field" && !resolve.field) {
      diagnostics.push({ path: ["triggers", "scanner", "resolve", "field"], message: "scanner resolve by field requires field" });
    }
  }

  const bulkInput = definition.triggers.bulkSelection?.input;
  if (bulkInput) {
    const input = inputs[bulkInput];
    if (!input) {
      diagnostics.push({
        path: ["triggers", "bulkSelection", "input"],
        message: `triggers.bulkSelection.input: unknown input "${bulkInput}"`,
      });
    } else if (input.type !== "recordList") {
      diagnostics.push({
        path: ["triggers", "bulkSelection", "input"],
        message: "triggers.bulkSelection.input must reference a recordList input",
      });
    }
  }

  const recordEventInput = definition.triggers.recordEvent?.input;
  if (recordEventInput) {
    const input = inputs[recordEventInput];
    if (!input) {
      diagnostics.push({
        path: ["triggers", "recordEvent", "input"],
        message: `triggers.recordEvent.input: unknown input "${recordEventInput}"`,
      });
    } else if (input.type !== "record") {
      diagnostics.push({ path: ["triggers", "recordEvent", "input"], message: "triggers.recordEvent.input must reference a record input" });
    }
  }
};

const validateSteps = (
  steps: unknown[],
  inputs: Record<string, WorkflowInput>,
  diagnostics: WorkflowDiagnostic[],
  path: (string | number)[] = ["steps"],
  locals = new Map<string, RefKind>(),
): void => {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepPath = [...path, index];
    if (!step || typeof step !== "object" || Array.isArray(step)) continue;
    const item = step as Record<string, unknown>;

    if ("updateRecord" in item) {
      const action = item.updateRecord as { record?: unknown };
      expectRefKind({
        ref: action.record,
        expected: "record",
        inputs,
        locals,
        diagnostics,
        path: [...stepPath, "updateRecord", "record"],
        label: "record",
      });
      continue;
    }

    if ("createRecord" in item) {
      const action = item.createRecord as { saveAs?: unknown };
      if (typeof action.saveAs === "string") locals.set(action.saveAs, "record");
      continue;
    }

    if ("generateDocument" in item) {
      const action = item.generateDocument as { record?: unknown; saveAs?: unknown };
      expectRefKind({
        ref: action.record,
        expected: "record",
        inputs,
        locals,
        diagnostics,
        path: [...stepPath, "generateDocument", "record"],
        label: "record",
      });
      if (typeof action.saveAs === "string") locals.set(action.saveAs, "document");
      continue;
    }

    if ("createDocumentLink" in item) {
      const action = item.createDocumentLink as { document?: unknown; saveAs?: unknown };
      expectRefKind({
        ref: action.document,
        expected: "document",
        inputs,
        locals,
        diagnostics,
        path: [...stepPath, "createDocumentLink", "document"],
        label: "document",
      });
      if (typeof action.saveAs === "string") locals.set(action.saveAs, "documentLink");
      continue;
    }

    if ("sendEmail" in item) {
      const action = item.sendEmail as { to?: unknown; saveAs?: unknown };
      if (Array.isArray(action.to)) {
        action.to.forEach((recipient, recipientIndex) => {
          if (!recipient || typeof recipient !== "object" || Array.isArray(recipient)) return;
          const keys = Object.keys(recipient);
          if (keys.length !== 1 || (keys[0] !== "email" && keys[0] !== "user")) {
            const recipientPath = [...stepPath, "sendEmail", "to", recipientIndex];
            diagnostics.push({
              path: recipientPath,
              message: `${compactPath(recipientPath)}: recipient must use exactly one of email or user`,
            });
          }
        });
      }
      if (typeof action.saveAs === "string") locals.set(action.saveAs, "email");
      continue;
    }

    if ("forEach" in item) {
      expectRefKind({
        ref: item.forEach,
        expected: "recordList",
        inputs,
        locals,
        diagnostics,
        path: [...stepPath, "forEach"],
        label: "forEach",
      });
      const nextLocals = new Map(locals);
      if (typeof item.as === "string") nextLocals.set(item.as, "record");
      if (Array.isArray(item.do)) validateSteps(item.do, inputs, diagnostics, [...stepPath, "do"], nextLocals);
      continue;
    }

    if ("if" in item) {
      if (Array.isArray(item.then)) validateSteps(item.then, inputs, diagnostics, [...stepPath, "then"], locals);
      if (Array.isArray(item.else)) validateSteps(item.else, inputs, diagnostics, [...stepPath, "else"], locals);
      continue;
    }

    if ("switch" in item) {
      const cases = item.cases;
      if (Array.isArray(cases)) {
        cases.forEach((caseItem, caseIndex) => {
          if (caseItem && typeof caseItem === "object" && Array.isArray((caseItem as { do?: unknown }).do)) {
            validateSteps((caseItem as { do: unknown[] }).do, inputs, diagnostics, [...stepPath, "cases", caseIndex, "do"], locals);
          }
        });
      }
      if (Array.isArray(item.default)) validateSteps(item.default, inputs, diagnostics, [...stepPath, "default"], locals);
    }
  }
};

export const validateWorkflowDefinition = (definition: WorkflowDefinition): WorkflowDiagnostic[] => {
  const diagnostics: WorkflowDiagnostic[] = [];
  validateTriggers(definition, diagnostics);
  validateSteps(definition.steps, definition.inputs ?? {}, diagnostics);
  return diagnostics;
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
