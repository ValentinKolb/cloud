import { describe, expect, test } from "bun:test";
import type { GridsWorkflowRunEvent } from "../../../lib/workflow-run-events";
import { createWorkflowRunEventBuffer } from "./workflow-run-event-buffer";

const event = (runId: string, status: "running" | "succeeded"): GridsWorkflowRunEvent => ({
  v: 1,
  baseId: "11111111-1111-4111-8111-111111111111",
  workflowId: "22222222-2222-4222-8222-222222222222",
  run: {
    id: runId,
    workflowId: "22222222-2222-4222-8222-222222222222",
    baseId: "11111111-1111-4111-8111-111111111111",
    triggerKind: "scanner",
    status,
    error: null,
    resultMessage: status === "succeeded" ? "Done" : null,
    createdAt: "2026-07-11T00:00:00.000Z",
    startedAt: "2026-07-11T00:00:00.100Z",
    finishedAt: status === "succeeded" ? "2026-07-11T00:00:00.200Z" : null,
  },
  steps: [],
  scope: { kind: "workflow" },
});

describe("workflow run event buffer", () => {
  test("keeps the newest event until the POST response reveals the run id", () => {
    const buffer = createWorkflowRunEventBuffer();
    buffer.push(event("run-1", "running"));
    buffer.push(event("run-1", "succeeded"));

    expect(buffer.take("run-1")?.run.status).toBe("succeeded");
    expect(buffer.take("run-1")).toBeNull();
  });

  test("bounds unmatched events", () => {
    const buffer = createWorkflowRunEventBuffer(1);
    buffer.push(event("run-1", "running"));
    buffer.push(event("run-2", "running"));

    expect(buffer.take("run-1")).toBeNull();
    expect(buffer.take("run-2")?.run.id).toBe("run-2");
  });
});
