import type { TraceSpan } from "@valentinkolb/cloud/services";
import type { WorkflowRunState } from "@valentinkolb/cloud/workflows";
import type { WorkflowRunSummary } from "@valentinkolb/cloud/workflows/store";

export type MailAutomationActivityKind = "automatic_reply" | "sender_rule" | "workflow" | "backfill";
export type MailAutomationActivityStatus = WorkflowRunState | "completed";

export type MailAutomationActivityItem = {
  id: string;
  kind: MailAutomationActivityKind;
  name: string;
  status: MailAutomationActivityStatus;
  occurredAt: string;
  durationMs: number | null;
  detail: string | null;
  href: string;
};

export type MailAutomationActivityCounts = {
  total: number;
  active: number;
  failed: number;
  backfills: number;
};

const sentenceCase = (value: string): string => {
  const words = value
    .replaceAll("_", " ")
    .replaceAll(".", " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .toLocaleLowerCase();
  return words ? `${words[0]?.toLocaleUpperCase()}${words.slice(1)}` : value;
};

const workflowErrorMessage = (run: WorkflowRunSummary): string | null => {
  if (run.resultMessage) return run.resultMessage;
  if (!run.error || typeof run.error !== "object" || Array.isArray(run.error)) return null;
  const message = run.error.message;
  if (typeof message === "string" && message !== "[object Object]") return message;
  const code = run.error.code;
  return typeof code === "string" ? sentenceCase(code) : null;
};

export const projectMailWorkflowActivity = (params: {
  mailboxId: string;
  run: WorkflowRunSummary;
  replyWorkflowIds: ReadonlySet<string>;
  senderRuleWorkflowIds: ReadonlySet<string>;
  workflowNames?: ReadonlyMap<string, string>;
}): MailAutomationActivityItem => {
  const { mailboxId, run, replyWorkflowIds, senderRuleWorkflowIds, workflowNames } = params;
  const kind: MailAutomationActivityKind = replyWorkflowIds.has(run.workflowId)
    ? "automatic_reply"
    : senderRuleWorkflowIds.has(run.workflowId)
      ? "sender_rule"
      : "workflow";
  const section = kind === "automatic_reply" ? "replies" : kind === "sender_rule" ? "rules" : "workflows";
  return {
    id: `run:${run.id}`,
    kind,
    name: workflowNames?.get(run.workflowId) ?? run.workflowName,
    status: run.state,
    occurredAt: run.createdAt.toISOString(),
    durationMs: run.durationMs,
    detail: workflowErrorMessage(run) ?? (run.eventType ? sentenceCase(run.eventType.split(".").at(-1) ?? run.eventType) : null),
    href: `/app/mail/${mailboxId}/automations/${section}`,
  };
};

const attributeString = (span: TraceSpan, key: string): string | null => {
  const value = span.attributes?.[key];
  return typeof value === "string" ? value : null;
};

export const projectMailBackfillActivity = (params: {
  mailboxId: string;
  span: TraceSpan;
  ruleNames: ReadonlyMap<string, string>;
}): MailAutomationActivityItem => {
  const { mailboxId, span, ruleNames } = params;
  const ruleId = attributeString(span, "mail.sender_rule.id");
  const dispatched = span.summary?.dispatched;
  const summaryStatus = span.summary?.status;
  const status: MailAutomationActivityStatus = span.endedAt
    ? span.status === "error" || summaryStatus === "failed"
      ? "failed"
      : "completed"
    : "running";
  return {
    id: `backfill:${span.traceId}:${span.spanId}`,
    kind: "backfill",
    name: ruleId ? `Backfill · ${ruleNames.get(ruleId) ?? "Sender rule"}` : "Sender rule backfill",
    status,
    occurredAt: span.startedAt,
    durationMs: span.durationMs,
    detail:
      span.statusMessage ??
      (typeof dispatched === "number" ? `${dispatched} matching message${dispatched === 1 ? "" : "s"} dispatched` : null),
    href: `/app/mail/${mailboxId}/automations/rules`,
  };
};

export const summarizeMailAutomationActivity = (items: MailAutomationActivityItem[]): MailAutomationActivityCounts => ({
  total: items.length,
  active: items.filter((item) => ["queued", "running", "waiting"].includes(item.status)).length,
  failed: items.filter((item) => ["failed", "needs_attention"].includes(item.status)).length,
  backfills: items.filter((item) => item.kind === "backfill").length,
});
