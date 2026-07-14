import { describe, expect, test } from "bun:test";
import {
  extractOperations,
  filterOperations,
  findOperation,
  joinOpenApiPath,
  operationJson,
  parseOpenApiDocument,
  renderOperation,
  renderSchema,
  searchOperations,
} from "./openapi";
import type { ApiDocSource } from "./sources";

const source: ApiDocSource = {
  id: "grids",
  name: "Grids",
  description: "Structured data.",
  url: "/api/grids/openapi.json",
};

const document = parseOpenApiDocument({
  openapi: "3.1.0",
  servers: [{ url: "/api/grids/" }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/records/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      get: {
        operationId: "getRecord",
        tags: ["Records"],
        summary: "Get one record",
        responses: { 200: { description: "Record", content: { "application/json": { schema: { type: "object" } } } } },
      },
      patch: {
        operationId: "updateRecord",
        tags: ["Records"],
        summary: "Update one record",
        security: [],
        parameters: [{ name: "id", in: "path", required: true, description: "Operation override", schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", minLength: 1, description: "New name" },
                  labels: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: { 204: { description: "Updated" } },
      },
    },
  },
});

describe("OpenAPI operations", () => {
  test("joins server bases and extracts inherited or explicit security", () => {
    const operations = extractOperations(source, document);
    expect(operations).toHaveLength(2);
    expect(operations[0]?.effectivePath).toBe("/api/grids/records/{id}");
    expect(operations.find((operation) => operation.method === "GET")?.security).toEqual({ state: "required", schemes: ["bearerAuth"] });
    expect(operations.find((operation) => operation.method === "PATCH")?.security).toEqual({ state: "public", schemes: [] });
    expect(operations.find((operation) => operation.method === "PATCH")?.parameters).toHaveLength(1);
  });

  test("never treats missing security metadata as public", () => {
    const [operation] = extractOperations(
      source,
      parseOpenApiDocument({ paths: { "/health": { get: { operationId: "health", responses: {} } } } }),
    );
    expect(operation?.security).toEqual({ state: "not-declared", schemes: [] });
  });

  test("recognizes an anonymous security alternative as public", () => {
    const [operation] = extractOperations(
      source,
      parseOpenApiDocument({ security: [{ bearerAuth: [] }, {}], paths: { "/health": { get: { responses: {} } } } }),
    );
    expect(operation?.security).toEqual({ state: "public", schemes: [] });
  });

  test("filters, searches, and resolves raw or effective paths", () => {
    const operations = extractOperations(source, document);
    expect(filterOperations(operations, { method: "patch", tag: "records" }).map((operation) => operation.operationId)).toEqual([
      "updateRecord",
    ]);
    expect(searchOperations(operations, "update record")[0]?.operationId).toBe("updateRecord");
    expect(findOperation(operations, "GET", "/records/{id}").operationId).toBe("getRecord");
    expect(findOperation(operations, "PATCH", "/api/grids/records/{id}").operationId).toBe("updateRecord");
  });

  test("renders compact operation details and preserves exact JSON", () => {
    const operation = findOperation(extractOperations(source, document), "PATCH", "/records/{id}");
    const text = renderOperation(operation);
    expect(text).toContain("PATCH /api/grids/records/{id}");
    expect(text).toContain("Security: public");
    expect(text).toContain("name*: string - New name; minLength: 1");
    expect(text).toContain("labels: array");
    expect(operationJson(operation).operation).toBe(operation.operation);
  });
});

describe("OpenAPI schema rendering", () => {
  test("supports refs, unions, arrays, and additional properties", () => {
    expect(
      renderSchema({
        oneOf: [{ $ref: "#/components/schemas/User" }, { type: "array", items: { type: "integer" } }],
        additionalProperties: { type: "boolean", default: false },
      }).join("\n"),
    ).toContain("#/components/schemas/User");
    expect(renderSchema({ type: ["string", "null"], enum: ["a", null] })[0]).toBe('string | null - enum: "a", null');
  });

  test("joins relative and absolute server URLs without duplicate slashes", () => {
    expect(joinOpenApiPath("/api/grids/", "/records")).toBe("/api/grids/records");
    expect(joinOpenApiPath("https://api.example.com/v1/", "/records")).toBe("https://api.example.com/v1/records");
  });
});
