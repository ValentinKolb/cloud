import { describe, expect, test } from "bun:test";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import { createWorkflowRunRoutes } from "./workflow-run-routes";
import { createWorkflowTriggerRoutes, DIRECT_WORKFLOW_CHANNEL } from "./workflow-trigger-routes";

const directInvocation = {
  idempotencyKey: "invalid-id-test",
  mode: "execute",
  inputs: {},
};

const app = () => new Hono<AuthContext>().route("/workflows", createWorkflowRunRoutes()).route("/workflows", createWorkflowTriggerRoutes());

describe("workflow route contracts", () => {
  test("uses one canonical channel for every direct external invocation route", () => {
    expect(DIRECT_WORKFLOW_CHANNEL).toBe("api");
  });

  test("rejects invalid base, workflow, launcher, and run ids before service calls", async () => {
    const requests = [
      app().request("/workflows/by-base/not-a-uuid/runs"),
      app().request("/workflows/not-a-uuid/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(directInvocation),
      }),
      app().request("/workflows/launchers/not-a-uuid/invoke/scanner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationId: "invalid-id-test",
          mode: "execute",
          expectedRevision: 1,
          scannedText: "gsc_opaque",
          inputs: {},
        }),
      }),
      app().request("/workflows/runs/not-a-uuid"),
    ];

    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      { message: "Invalid base id" },
      { message: "Invalid workflow id" },
      { message: "Invalid workflow launcher id" },
      { message: "Invalid workflow run id" },
    ]);
  });

  test("publishes actual run-route error statuses in OpenAPI", async () => {
    const spec = await generateSpecs(app());

    expect(Object.keys(spec.paths?.["/workflows/by-base/{baseId}/runs"]?.get?.responses ?? {})).toEqual(["200", "400", "403", "404"]);
    expect(Object.keys(spec.paths?.["/workflows/runs/{runId}/steps"]?.get?.responses ?? {})).toEqual(["200", "400", "403", "404"]);
  });

  test("publishes infrastructure failures for workflow invocation routes", async () => {
    const spec = await generateSpecs(app());

    expect(Object.keys(spec.paths?.["/workflows/{workflowId}/invoke"]?.post?.responses ?? {})).toEqual([
      "200",
      "400",
      "403",
      "404",
      "409",
      "500",
    ]);
    expect(Object.keys(spec.paths?.["/workflows/launchers/{launcherId}/invoke/scanner"]?.post?.responses ?? {})).toEqual([
      "200",
      "400",
      "403",
      "404",
      "409",
      "500",
    ]);
  });
});
