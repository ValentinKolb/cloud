import { describe, expect, test } from "bun:test";
import { type GridsOperationalHealth, operationalIssues } from "./operational-health";

const healthy = (): Omit<GridsOperationalHealth, "issues"> => ({
  status: "ok",
  observedAt: "2026-07-22T10:00:00.000Z",
  outbox: { pending: 0, failed: 0, dead: 0, oldestActiveAgeSeconds: 0 },
  workflows: { queued: 0, running: 0, waiting: 0, needsAttention: 0, staleRunning: 0, oldestQueuedAgeSeconds: 0 },
  effects: { pending: 0, executing: 0, needsAttention: 0, oldestActiveAgeSeconds: 0 },
  federatedDegraded: 0,
  emailFailed24h: 0,
  gql: { total24h: 0, errors24h: 0, avgDurationMs24h: 0, p99DurationMs24h: 0 },
});

describe("operationalIssues", () => {
  test("keeps an idle system quiet", () => {
    expect(operationalIssues(healthy())).toEqual([]);
  });

  test("separates intervention from delayed work", () => {
    const health = healthy();
    health.outbox.dead = 2;
    health.outbox.pending = 3;
    health.outbox.oldestActiveAgeSeconds = 75;
    const issues = operationalIssues(health);

    expect(issues.map((issue) => [issue.severity, issue.title])).toEqual([
      ["error", "Record events need intervention"],
      ["warn", "Record events are delayed"],
    ]);
  });

  test("reports every actionable domain without exposing resource ids", () => {
    const health = healthy();
    health.workflows.needsAttention = 1;
    health.workflows.staleRunning = 1;
    health.workflows.oldestQueuedAgeSeconds = 61;
    health.effects.oldestActiveAgeSeconds = 301;
    health.federatedDegraded = 1;
    health.emailFailed24h = 1;

    expect(operationalIssues(health)).toHaveLength(6);
  });
});
