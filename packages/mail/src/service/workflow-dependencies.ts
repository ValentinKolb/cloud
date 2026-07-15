import { logger } from "@valentinkolb/cloud/services";
import type { WorkflowDependency } from "@valentinkolb/cloud/workflows";
import { topic } from "@valentinkolb/sync";

const log = logger("mail:workflow-dependencies");

export type MailWorkflowDependencyEvent = WorkflowDependency & {
  mailboxId: string;
  occurredAt: string;
};

const dependencyTopic = topic<MailWorkflowDependencyEvent>({
  id: "workflow-dependencies",
  prefix: "cloud:mail:workflows",
  retentionMs: 24 * 60 * 60 * 1_000,
  limits: { payloadBytes: 2_000 },
});

export const publishMailWorkflowDependency = async (input: { mailboxId: string; dependency: WorkflowDependency }): Promise<void> => {
  const event: MailWorkflowDependencyEvent = {
    mailboxId: input.mailboxId,
    ...input.dependency,
    occurredAt: new Date().toISOString(),
  };
  try {
    await dependencyTopic.pub({
      tenantId: input.mailboxId,
      orderingKey: `${input.dependency.kind}:${input.dependency.key}`,
      idempotencyKey: `dependency:${input.dependency.kind}:${input.dependency.key}`,
      data: event,
    });
  } catch (error) {
    // PostgreSQL reconciliation is authoritative; topic delivery only reduces wakeup latency.
    log.warn("Failed to publish Mail workflow dependency", {
      mailboxId: input.mailboxId,
      kind: input.dependency.kind,
      key: input.dependency.key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const liveMailWorkflowDependencies = (params: { mailboxId: string; after?: string | null; signal?: AbortSignal }) =>
  dependencyTopic.live({
    tenantId: params.mailboxId,
    after: params.after ?? "0-0",
    signal: params.signal,
  });

export const latestMailWorkflowDependencyCursor = (mailboxId: string): Promise<string | null> =>
  dependencyTopic.latestCursor({ tenantId: mailboxId });
