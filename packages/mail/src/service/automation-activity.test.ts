import { describe, expect, test } from "bun:test";
import type { TraceSpan } from "@valentinkolb/cloud/services";
import type { WorkflowRunSummary } from "@valentinkolb/cloud/workflows/store";
import { projectMailBackfillActivity, projectMailWorkflowActivity, summarizeMailAutomationActivity } from "./automation-activity";

const run = (workflowId: string, state: WorkflowRunSummary["state"] = "succeeded"): WorkflowRunSummary => ({
  id: `run-${workflowId}`,
  appId: "mail",
  scopeId: "mailbox-1",
  workflowId,
  workflowName: `Workflow ${workflowId}`,
  revision: 1,
  mode: "execute",
  state,
  attempt: 1,
  eventType: "mail.message.received",
  parentRunId: null,
  occurredAt: new Date("2026-07-28T10:00:00.000Z"),
  createdAt: new Date("2026-07-28T10:00:01.000Z"),
  startedAt: new Date("2026-07-28T10:00:01.100Z"),
  finishedAt: new Date("2026-07-28T10:00:01.200Z"),
  startLagMs: 100,
  durationMs: 100,
  error: null,
  resultMessage: null,
});

const backfillSpan = (overrides: Partial<TraceSpan> = {}): TraceSpan => ({
  traceId: "trace-1",
  spanId: "span-1",
  traceparent: "00-trace-1-span-1-01",
  spanKey: "sync:pump:mail:sender-rule-backfill:one",
  parentSpanId: null,
  name: "Sender rule backfill",
  source: "mail:sender-rule-backfill",
  appId: "mail",
  category: "backfill",
  kind: "internal",
  status: "ok",
  statusMessage: null,
  attributes: { "mail.mailbox.id": "mailbox-1", "mail.sender_rule.id": "rule-1" },
  summary: { status: "completed", dispatched: 3 },
  eventCount: 4,
  startedAt: "2026-07-28T10:00:00.000Z",
  endedAt: "2026-07-28T10:00:02.000Z",
  durationMs: 2_000,
  updatedAt: "2026-07-28T10:00:02.000Z",
  ...overrides,
});

describe("Mail automation activity projection", () => {
  test("distinguishes guided replies, sender rules, and custom workflows", () => {
    const common = {
      mailboxId: "mailbox-1",
      replyWorkflowIds: new Set(["reply"]),
      senderRuleWorkflowIds: new Set(["rule"]),
      workflowNames: new Map([["rule", "Invoices"]]),
    };
    expect(projectMailWorkflowActivity({ ...common, run: run("reply") })).toMatchObject({
      kind: "automatic_reply",
      detail: "Received",
      href: "/app/mail/mailbox-1/automations/replies",
    });
    expect(projectMailWorkflowActivity({ ...common, run: run("rule") })).toMatchObject({
      kind: "sender_rule",
      name: "Invoices",
      href: "/app/mail/mailbox-1/automations/rules",
    });
    expect(projectMailWorkflowActivity({ ...common, run: run("custom") })).toMatchObject({
      kind: "workflow",
      href: "/app/mail/mailbox-1/automations/workflows",
    });
  });

  test("projects backfill progress and terminal failure without inventing a Mail run store", () => {
    expect(
      projectMailBackfillActivity({
        mailboxId: "mailbox-1",
        span: backfillSpan(),
        ruleNames: new Map([["rule-1", "Invoices"]]),
      }),
    ).toMatchObject({
      kind: "backfill",
      name: "Backfill · Invoices",
      status: "completed",
      detail: "3 matching messages dispatched",
    });
    expect(
      projectMailBackfillActivity({
        mailboxId: "mailbox-1",
        span: backfillSpan({ status: "error", statusMessage: "Provider unavailable" }),
        ruleNames: new Map(),
      }),
    ).toMatchObject({ status: "failed", detail: "Provider unavailable" });
  });

  test("never exposes broken object coercion from an older stored workflow error", () => {
    const failed = run("rule", "failed");
    failed.error = { code: "CONFLICT", message: "[object Object]", retryable: false };
    expect(
      projectMailWorkflowActivity({
        mailboxId: "mailbox-1",
        run: failed,
        replyWorkflowIds: new Set(),
        senderRuleWorkflowIds: new Set(["rule"]),
      }),
    ).toMatchObject({ detail: "Conflict" });
  });

  test("summarizes active and actionable entries", () => {
    const common = {
      mailboxId: "mailbox-1",
      replyWorkflowIds: new Set<string>(),
      senderRuleWorkflowIds: new Set<string>(),
    };
    const items = [
      projectMailWorkflowActivity({ ...common, run: run("one", "running") }),
      projectMailWorkflowActivity({ ...common, run: run("two", "failed") }),
      projectMailBackfillActivity({ mailboxId: "mailbox-1", span: backfillSpan(), ruleNames: new Map() }),
    ];
    expect(summarizeMailAutomationActivity(items)).toEqual({ total: 3, active: 1, failed: 1, backfills: 1 });
  });
});
