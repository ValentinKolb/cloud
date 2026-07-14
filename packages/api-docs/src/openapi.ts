import type { ApiDocSource } from "./sources";

type JsonObject = Record<string, unknown>;

export type OpenApiDocument = JsonObject & {
  openapi?: string;
  info?: JsonObject;
  servers?: unknown[];
  security?: unknown[];
  paths?: Record<string, unknown>;
};

export type OperationSecurity = {
  state: "required" | "public" | "not-declared";
  schemes: string[];
};

export type ApiOperation = {
  app: Pick<ApiDocSource, "id" | "name">;
  method: string;
  path: string;
  effectivePath: string;
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  security: OperationSecurity;
  parameters: unknown[];
  requestBody?: unknown;
  responses?: unknown;
  operation: JsonObject;
};

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

const isObject = (value: unknown): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const stringValue = (value: unknown): string => (typeof value === "string" ? value : "");
const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const compactText = (value: unknown): string => stringValue(value).replace(/\s+/g, " ").trim();

export const parseOpenApiDocument = (value: unknown): OpenApiDocument => {
  if (!isObject(value) || !isObject(value.paths)) throw new Error("OpenAPI document has no paths object.");
  return value as OpenApiDocument;
};

const serverUrl = (document: OpenApiDocument): string => {
  const server = Array.isArray(document.servers) ? document.servers.find(isObject) : undefined;
  return server ? stringValue(server.url).trim() : "";
};

export const joinOpenApiPath = (base: string, path: string): string => {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (!base || base === "/") return cleanPath;
  return `${base.replace(/\/+$/, "")}${cleanPath}`;
};

const securityFor = (document: OpenApiDocument, operation: JsonObject): OperationSecurity => {
  const declared = Object.hasOwn(operation, "security") ? operation.security : document.security;
  if (!Array.isArray(declared)) return { state: "not-declared", schemes: [] };
  if (declared.length === 0 || declared.some((requirement) => isObject(requirement) && Object.keys(requirement).length === 0)) {
    return { state: "public", schemes: [] };
  }

  const schemes = declared
    .flatMap((requirement) => (isObject(requirement) ? Object.keys(requirement) : []))
    .filter((name, index, values) => values.indexOf(name) === index)
    .sort();
  return { state: "required", schemes };
};

export const extractOperations = (source: ApiDocSource, document: OpenApiDocument): ApiOperation[] => {
  const base = serverUrl(document);
  const operations: ApiOperation[] = [];

  for (const [path, rawPathItem] of Object.entries(document.paths ?? {})) {
    if (!isObject(rawPathItem)) continue;
    const sharedParameters = Array.isArray(rawPathItem.parameters) ? rawPathItem.parameters : [];
    for (const method of HTTP_METHODS) {
      const operation = rawPathItem[method];
      if (!isObject(operation)) continue;
      operations.push({
        app: { id: source.id, name: source.name },
        method: method.toUpperCase(),
        path,
        effectivePath: joinOpenApiPath(base, path),
        operationId: stringValue(operation.operationId),
        summary: compactText(operation.summary),
        description: compactText(operation.description),
        tags: stringList(operation.tags),
        security: securityFor(document, operation),
        parameters: mergeParameters(sharedParameters, Array.isArray(operation.parameters) ? operation.parameters : []),
        requestBody: operation.requestBody,
        responses: operation.responses,
        operation,
      });
    }
  }

  return operations.sort(
    (a, b) => a.effectivePath.localeCompare(b.effectivePath) || a.method.localeCompare(b.method) || a.operationId.localeCompare(b.operationId),
  );
};

const parameterKey = (parameter: unknown, index: number): string => {
  if (!isObject(parameter)) return `value:${index}`;
  if (typeof parameter.$ref === "string") return `$ref:${parameter.$ref}`;
  const location = stringValue(parameter.in);
  const name = stringValue(parameter.name);
  return location || name ? `${location}:${name}` : `value:${index}`;
};

const mergeParameters = (shared: readonly unknown[], own: readonly unknown[]): unknown[] => {
  const merged = new Map<string, unknown>();
  shared.forEach((parameter, index) => merged.set(parameterKey(parameter, index), parameter));
  own.forEach((parameter, index) => merged.set(parameterKey(parameter, shared.length + index), parameter));
  return [...merged.values()];
};

export const filterOperations = (
  operations: readonly ApiOperation[],
  filters: { method?: string; tag?: string } = {},
): ApiOperation[] => {
  const method = filters.method?.trim().toUpperCase();
  const tag = filters.tag?.trim().toLowerCase();
  return operations.filter(
    (operation) =>
      (!method || operation.method === method) && (!tag || operation.tags.some((operationTag) => operationTag.toLowerCase() === tag)),
  );
};

const searchText = (operation: ApiOperation): string =>
  [
    operation.app.id,
    operation.app.name,
    operation.method,
    operation.path,
    operation.effectivePath,
    operation.operationId,
    operation.summary,
    operation.description,
    ...operation.tags,
    JSON.stringify(operation.operation),
  ]
    .join(" ")
    .toLowerCase();

export const searchOperations = (operations: readonly ApiOperation[], query: string): ApiOperation[] => {
  const normalized = query.trim().toLowerCase();
  const terms = normalized.split(/\s+/).filter(Boolean);
  if (terms.length === 0) throw new Error("Search query must not be empty.");

  return operations
    .flatMap((operation) => {
      const haystack = searchText(operation);
      if (!terms.every((term) => haystack.includes(term))) return [];
      const title = `${operation.operationId} ${operation.summary}`.toLowerCase();
      const route = `${operation.method} ${operation.effectivePath}`.toLowerCase();
      const score = (title.includes(normalized) ? 4 : 0) + (route.includes(normalized) ? 3 : 0) + terms.filter((term) => title.includes(term)).length;
      return [{ operation, score }];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.operation.app.id.localeCompare(b.operation.app.id) ||
        a.operation.effectivePath.localeCompare(b.operation.effectivePath) ||
        a.operation.method.localeCompare(b.operation.method),
    )
    .map(({ operation }) => operation);
};

const normalizeRoute = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, "") || "/";
  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return trimmed;
  }
};

export const findOperation = (operations: readonly ApiOperation[], method: string, path: string): ApiOperation => {
  const normalizedMethod = method.trim().toUpperCase();
  const normalizedPath = normalizeRoute(path);
  const matches = operations.filter(
    (operation) =>
      operation.method === normalizedMethod &&
      [operation.path, operation.effectivePath].some((candidate) => normalizeRoute(candidate) === normalizedPath),
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`Operation ${normalizedMethod} ${path} is ambiguous.`);
  throw new Error(`Operation ${normalizedMethod} ${path} was not found.`);
};

export const operationRow = (operation: ApiOperation) => ({
  app: operation.app.id,
  method: operation.method,
  path: operation.effectivePath,
  operationId: operation.operationId,
  summary: operation.summary,
  tags: operation.tags.join(", "),
  security: operation.security.state,
});

const schemaType = (schema: JsonObject): string => {
  if (typeof schema.$ref === "string") return schema.$ref;
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (typeof schema.type === "string") return schema.format ? `${schema.type}<${String(schema.format)}>` : schema.type;
  if (schema.properties) return "object";
  if (schema.items) return "array";
  if (schema.oneOf || schema.anyOf) return "union";
  if (schema.allOf) return "intersection";
  return "any";
};

const schemaDetails = (schema: JsonObject): string[] => {
  const details: string[] = [];
  if (Object.hasOwn(schema, "const")) details.push(`const: ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum)) details.push(`enum: ${schema.enum.map((value) => JSON.stringify(value)).join(", ")}`);
  if (Object.hasOwn(schema, "default")) details.push(`default: ${JSON.stringify(schema.default)}`);
  for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"] as const) {
    if (typeof schema[key] === "number") details.push(`${key}: ${schema[key]}`);
  }
  return details;
};

export const renderSchema = (value: unknown, indent = "", seen = new WeakSet<object>()): string[] => {
  if (!isObject(value)) return [`${indent}${value === undefined ? "unspecified" : JSON.stringify(value)}`];
  if (seen.has(value)) return [`${indent}(recursive schema)`];
  seen.add(value);

  const description = compactText(value.description);
  const details = schemaDetails(value);
  const suffix = [description, ...details].filter(Boolean).join("; ");
  const lines = [`${indent}${schemaType(value)}${suffix ? ` - ${suffix}` : ""}`];

  for (const combinator of ["oneOf", "anyOf", "allOf"] as const) {
    if (!Array.isArray(value[combinator])) continue;
    lines.push(`${indent}  ${combinator}:`);
    value[combinator].forEach((schema, index) => {
      lines.push(`${indent}    ${index + 1}.`);
      lines.push(...renderSchema(schema, `${indent}      `, seen));
    });
  }

  if (isObject(value.properties)) {
    const required = new Set(stringList(value.required));
    for (const [name, property] of Object.entries(value.properties)) {
      const rendered = renderSchema(property, "", seen);
      const [first = "any", ...rest] = rendered;
      lines.push(`${indent}  ${name}${required.has(name) ? "*" : ""}: ${first}`);
      lines.push(...rest.map((line) => `${indent}  ${line}`));
    }
  }

  if (value.items !== undefined) {
    lines.push(`${indent}  items:`);
    lines.push(...renderSchema(value.items, `${indent}    `, seen));
  }
  if (isObject(value.additionalProperties)) {
    lines.push(`${indent}  additional properties:`);
    lines.push(...renderSchema(value.additionalProperties, `${indent}    `, seen));
  } else if (value.additionalProperties === true) {
    lines.push(`${indent}  additional properties: any`);
  } else if (value.additionalProperties === false) {
    lines.push(`${indent}  additional properties: disallowed`);
  }

  seen.delete(value);
  return lines;
};

const renderParameters = (parameters: readonly unknown[]): string[] => {
  if (parameters.length === 0) return [];
  const lines = ["Parameters:"];
  for (const parameter of parameters) {
    if (!isObject(parameter)) continue;
    if (typeof parameter.$ref === "string") {
      lines.push(`  - ${parameter.$ref}`);
      continue;
    }
    const name = stringValue(parameter.name) || "unnamed";
    const location = stringValue(parameter.in) || "unknown";
    const required = parameter.required === true ? ", required" : "";
    const description = compactText(parameter.description);
    lines.push(`  - ${name} (${location}${required})${description ? ` - ${description}` : ""}`);
    if (parameter.schema !== undefined) lines.push(...renderSchema(parameter.schema, "      "));
  }
  return lines;
};

const renderContent = (content: unknown, indent: string): string[] => {
  if (!isObject(content)) return [];
  return Object.entries(content).flatMap(([contentType, media]) => {
    const lines = [`${indent}${contentType}`];
    if (isObject(media) && media.schema !== undefined) lines.push(...renderSchema(media.schema, `${indent}  `));
    return lines;
  });
};

const renderRequestBody = (requestBody: unknown): string[] => {
  if (requestBody === undefined) return [];
  if (!isObject(requestBody)) return ["Request body: unspecified"];
  if (typeof requestBody.$ref === "string") return [`Request body: ${requestBody.$ref}`];
  const lines = [`Request body:${requestBody.required === true ? " required" : " optional"}`];
  lines.push(...renderContent(requestBody.content, "  "));
  return lines;
};

const renderResponses = (responses: unknown): string[] => {
  if (!isObject(responses)) return [];
  const lines = ["Responses:"];
  for (const [status, response] of Object.entries(responses)) {
    if (!isObject(response)) {
      lines.push(`  ${status}`);
      continue;
    }
    if (typeof response.$ref === "string") {
      lines.push(`  ${status}: ${response.$ref}`);
      continue;
    }
    lines.push(`  ${status}${response.description ? `: ${compactText(response.description)}` : ""}`);
    lines.push(...renderContent(response.content, "    "));
  }
  return lines;
};

export const renderOperation = (operation: ApiOperation): string => {
  const security =
    operation.security.state === "required"
      ? `required${operation.security.schemes.length > 0 ? ` (${operation.security.schemes.join(", ")})` : ""}`
      : operation.security.state === "public"
        ? "public"
        : "not declared";
  const lines = [
    `${operation.method} ${operation.effectivePath}`,
    `App: ${operation.app.name} (${operation.app.id})`,
    `Operation ID: ${operation.operationId || "not declared"}`,
    `Tags: ${operation.tags.join(", ") || "none"}`,
    `Security: ${security}`,
  ];
  if (operation.summary) lines.push(`Summary: ${operation.summary}`);
  if (operation.description) lines.push(`Description: ${operation.description}`);
  lines.push(...renderParameters(operation.parameters));
  lines.push(...renderRequestBody(operation.requestBody));
  lines.push(...renderResponses(operation.responses));
  return lines.join("\n");
};

export const operationJson = (operation: ApiOperation) => ({
  app: operation.app,
  method: operation.method,
  path: operation.path,
  effectivePath: operation.effectivePath,
  operationId: operation.operationId || null,
  summary: operation.summary || null,
  description: operation.description || null,
  tags: operation.tags,
  security: operation.security,
  parameters: operation.parameters,
  requestBody: operation.requestBody ?? null,
  responses: operation.responses ?? null,
  operation: operation.operation,
});
