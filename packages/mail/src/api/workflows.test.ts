import { describe, expect, test } from "bun:test";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import workflowRoutes from "./workflows";

const app = () => new Hono<AuthContext>().route("/", workflowRoutes);

const expectedOperations = [
  ["post", "/mailboxes/{mailboxId}/workflows/validate", "Validate Mail workflow YAML", ["200", "400", "401", "403"]],
  ["get", "/mailboxes/{mailboxId}/workflows", "List Mail workflows", ["200", "400", "401", "403"]],
  ["post", "/mailboxes/{mailboxId}/workflows", "Create a Mail workflow", ["200", "400", "401", "403", "409", "500"]],
  ["get", "/mailboxes/{mailboxId}/workflows/{workflowId}", "Get a Mail workflow", ["200", "400", "401", "403", "404"]],
  ["get", "/mailboxes/{mailboxId}/workflows/{workflowId}/versions", "List Mail workflow versions", ["200", "400", "401", "403", "404"]],
  [
    "post",
    "/mailboxes/{mailboxId}/workflows/{workflowId}/versions",
    "Create a Mail workflow version",
    ["200", "400", "401", "403", "404", "500"],
  ],
  [
    "get",
    "/mailboxes/{mailboxId}/workflows/{workflowId}/versions/{versionId}",
    "Get a Mail workflow version",
    ["200", "400", "401", "403", "404"],
  ],
  [
    "post",
    "/mailboxes/{mailboxId}/workflows/{workflowId}/activate",
    "Activate a Mail workflow version",
    ["200", "400", "401", "403", "404", "409", "500"],
  ],
  [
    "post",
    "/mailboxes/{mailboxId}/workflows/{workflowId}/deactivate",
    "Deactivate a Mail workflow",
    ["200", "400", "401", "403", "404", "409", "500"],
  ],
  [
    "post",
    "/mailboxes/{mailboxId}/workflows/{workflowId}/preflight",
    "Preflight a Mail workflow run",
    ["200", "400", "401", "403", "404", "409"],
  ],
  [
    "post",
    "/mailboxes/{mailboxId}/workflows/{workflowId}/dry-run",
    "Create a durable Mail workflow dry run",
    ["200", "400", "401", "403", "404", "409", "500"],
  ],
  [
    "post",
    "/mailboxes/{mailboxId}/workflows/{workflowId}/invoke",
    "Invoke a Mail workflow",
    ["200", "400", "401", "403", "404", "409", "500"],
  ],
  [
    "post",
    "/mailboxes/{mailboxId}/workflows/{workflowId}/backfill",
    "Start a Mail workflow backfill",
    ["200", "400", "401", "403", "404", "409", "500"],
  ],
  [
    "post",
    "/mailboxes/{mailboxId}/workflows/{workflowId}/one-shot",
    "Start a one-shot Mail workflow run",
    ["200", "400", "401", "403", "404", "409", "500"],
  ],
  ["get", "/mailboxes/{mailboxId}/workflow-runs", "List Mail workflow runs", ["200", "400", "401", "403"]],
  ["get", "/mailboxes/{mailboxId}/workflow-runs/{runId}", "Get a Mail workflow run", ["200", "400", "401", "403", "404"]],
  ["get", "/mailboxes/{mailboxId}/workflow-runs/{runId}/targets", "List Mail workflow run targets", ["200", "400", "401", "403", "404"]],
  [
    "post",
    "/mailboxes/{mailboxId}/workflow-runs/{runId}/cancel",
    "Cancel a Mail workflow run",
    ["200", "400", "401", "403", "404", "409", "500"],
  ],
] as const;

describe("Mail workflow OpenAPI contracts", () => {
  test("publishes every operation with stable metadata, authentication, and response schemas", async () => {
    const spec = await generateSpecs(app());

    for (const [method, path, summary, statuses] of expectedOperations) {
      const operation = spec.paths?.[path]?.[method];
      const expectedStatuses = [...new Set([...statuses, "500"])].sort((left, right) => Number(left) - Number(right));
      expect(operation?.tags).toEqual(["Mail:Workflows"]);
      expect(operation?.summary).toBe(summary);
      expect(operation?.security).toEqual([{ cookieAuth: [], bearerAuth: [] }]);
      expect(Object.keys(operation?.responses ?? {})).toEqual(expectedStatuses);

      for (const status of expectedStatuses) {
        const response = operation?.responses?.[status];
        expect(response && "$ref" in response ? undefined : response?.content?.["application/json"]?.schema).toBeDefined();
      }
    }
  });

  test("does not publish dangling component references", async () => {
    const spec = await generateSpecs(app());
    const references = JSON.stringify(spec).match(/#\/components\/schemas\/[A-Za-z0-9_-]+/g) ?? [];
    const schemas = spec.components?.schemas ?? {};

    expect(references.filter((reference) => !(reference.slice("#/components/schemas/".length) in schemas))).toEqual([]);
  });

  test("represents recursive search expressions without an empty or dangling schema", async () => {
    const spec = await generateSpecs(app());
    const requestSchema = spec.paths?.["/mailboxes/{mailboxId}/workflows/{workflowId}/preflight"]?.post?.requestBody;
    expect(requestSchema && "$ref" in requestSchema ? undefined : requestSchema?.content?.["application/json"]?.schema).toBeDefined();

    const schema = (requestSchema as { content: { "application/json": { schema: any } } }).content["application/json"].schema;
    const expression = schema.properties.query.oneOf[1].properties.expression;
    expect(expression.$dynamicAnchor).toBe("MailSearchExpression");
    expect(expression.oneOf).toHaveLength(4);
    expect(expression.oneOf[1].properties.and.items).toEqual({ $dynamicRef: "#MailSearchExpression" });
    expect(expression.oneOf[2].properties.or.items).toEqual({ $dynamicRef: "#MailSearchExpression" });
    expect(expression.oneOf[3].properties.not).toEqual({ $dynamicRef: "#MailSearchExpression" });
    expect(expression.$ref).toBeUndefined();
  });
});
