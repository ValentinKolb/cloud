import { isAlias, isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from "yaml";
import type { WorkflowDiagnostic, WorkflowJsonValue, WorkflowSourceLocation } from "../contracts";
import { workflowPathKey } from "../contracts";

export type ParsedWorkflowYaml = {
  value: WorkflowJsonValue;
  sourceLocations: Record<string, WorkflowSourceLocation>;
};

export type ParseWorkflowYamlResult = { ok: true; parsed: ParsedWorkflowYaml } | { ok: false; diagnostics: WorkflowDiagnostic[] };

const locationAt = (lineCounter: LineCounter, offset: number): WorkflowSourceLocation => {
  const { line, col } = lineCounter.linePos(offset);
  return { offset, line, column: col };
};

const errorLocation = (lineCounter: LineCounter, error: unknown): WorkflowSourceLocation | undefined => {
  const offset = (error as { pos?: number[] }).pos?.[0];
  return typeof offset === "number" ? locationAt(lineCounter, offset) : undefined;
};

const diagnostic = (
  code: string,
  message: string,
  path: Array<string | number>,
  location?: WorkflowSourceLocation,
): WorkflowDiagnostic => ({ code, message, severity: "error", path, ...(location ? { location } : {}) });

type DecodeContext = {
  lineCounter: LineCounter;
  locations: Record<string, WorkflowSourceLocation>;
  diagnostics: WorkflowDiagnostic[];
};

const nodeLocation = (node: unknown, context: DecodeContext): WorkflowSourceLocation | undefined => {
  const offset = isNode(node) ? node.range?.[0] : undefined;
  return typeof offset === "number" ? locationAt(context.lineCounter, offset) : undefined;
};

const recordLocation = (node: unknown, path: Array<string | number>, context: DecodeContext): void => {
  const location = nodeLocation(node, context);
  const key = workflowPathKey(path);
  if (location && context.locations[key] === undefined) context.locations[key] = location;
};

const decodeNode = (node: unknown, path: Array<string | number>, context: DecodeContext): WorkflowJsonValue | undefined => {
  recordLocation(node, path, context);
  const location = nodeLocation(node, context);

  if (node === null) return null;
  if (!isNode(node)) {
    context.diagnostics.push(diagnostic("yaml.node", "Unsupported YAML node", path, location));
    return undefined;
  }
  if (isAlias(node)) {
    context.diagnostics.push(diagnostic("yaml.alias", "YAML aliases are not allowed", path, location));
    return undefined;
  }
  if (node.anchor) {
    context.diagnostics.push(diagnostic("yaml.anchor", "YAML anchors are not allowed", path, location));
    return undefined;
  }
  if (node.tag) {
    context.diagnostics.push(diagnostic("yaml.tag", "Explicit YAML tags are not allowed", path, location));
    return undefined;
  }

  if (isScalar(node)) {
    const value = node.value;
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    context.diagnostics.push(diagnostic("yaml.value", "YAML value must be valid JSON", path, location));
    return undefined;
  }

  if (isSeq(node)) {
    const result: WorkflowJsonValue[] = [];
    node.items.forEach((item, index) => {
      const value = decodeNode(item, [...path, index], context);
      if (value !== undefined) result.push(value);
    });
    return result;
  }

  if (isMap(node)) {
    const entries: Array<[string, WorkflowJsonValue]> = [];
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
        context.diagnostics.push(diagnostic("yaml.key", "YAML object keys must be strings", path, nodeLocation(pair.key, context)));
        continue;
      }
      const key = pair.key.value;
      const childPath = [...path, key];
      recordLocation(pair.key, childPath, context);
      const value = decodeNode(pair.value, childPath, context);
      if (value !== undefined) entries.push([key, value]);
    }
    return Object.fromEntries(entries) as Record<string, WorkflowJsonValue>;
  }

  context.diagnostics.push(diagnostic("yaml.node", "Unsupported YAML node", path, location));
  return undefined;
};

export const parseWorkflowYaml = (source: string): ParseWorkflowYamlResult => {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    lineCounter,
    prettyErrors: false,
    schema: "core",
    strict: true,
    uniqueKeys: true,
  });

  const parseDiagnostics = [...document.errors, ...document.warnings].map((error) =>
    diagnostic("yaml.parse", error.message, [], errorLocation(lineCounter, error)),
  );
  if (parseDiagnostics.length > 0) return { ok: false, diagnostics: parseDiagnostics };

  const context: DecodeContext = { lineCounter, locations: {}, diagnostics: [] };
  const value = decodeNode(document.contents, [], context);
  if (context.diagnostics.length > 0) return { ok: false, diagnostics: context.diagnostics };
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      diagnostics: [diagnostic("workflow.root", "Workflow source must be a YAML object", [], context.locations[""])],
    };
  }
  return { ok: true, parsed: { value, sourceLocations: context.locations } };
};
