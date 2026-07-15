import type { WorkflowJsonValue, WorkflowPlanningOutcome, WorkflowStepOutcome } from "@valentinkolb/cloud/workflows";
import { createWorkflowBuiltinActionPorts, workflowPathKey } from "@valentinkolb/cloud/workflows";
import type {
  WorkflowActionStep,
  WorkflowDryRunActionContext,
  WorkflowDryRunActionPort,
  WorkflowExecuteActionContext,
  WorkflowExecuteActionPort,
} from "@valentinkolb/cloud/workflows/runtime";
import { sql } from "bun";
import type { ActorCommandInput, MailCommand, RemoteMessagePrecondition, UpdateConversationCollaboration } from "../contracts";
import { sha256Text } from "./canonical";
import { updateConversationCollaborationInTransaction, updateWorkflowConversationCollaborationInTransaction } from "./collaboration";
import { createWorkflowCommand } from "./commands";
import { publishMailCollaborationEvent } from "./events";
import {
  applyMailConversationTransition,
  applyMailMessageTransition,
  isMailWorkflowProjectedObject,
  mailConversationTransitionChanges,
  mailMessageTransitionChanges,
} from "./workflow-projected-state";
import { type MailWorkflowExecutionAuthority, mailWorkflowExecutionAuthorityActive } from "./workflow-runtime-context";

type JsonObject = Record<string, WorkflowJsonValue>;
type SqlClient = typeof sql;

export type MailWorkflowRuntimeActionOptions = {
  authority: MailWorkflowExecutionAuthority;
  mailboxId: string;
  workflowVersionId: string;
  targetId: string;
  preconditions: WorkflowJsonValue;
};

const activeWorkflowAuthority = (options: MailWorkflowRuntimeActionOptions, db: SqlClient = sql): Promise<boolean> =>
  mailWorkflowExecutionAuthorityActive(options.authority, options.mailboxId, options.workflowVersionId, db);

const isJsonObject = (value: WorkflowJsonValue | undefined): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const textValue = (value: WorkflowJsonValue | undefined, label: string): string => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must resolve to text`);
  return value;
};

const objectValue = (value: WorkflowJsonValue | undefined, label: string): JsonObject => {
  if (!isJsonObject(value)) throw new Error(`${label} must resolve to an object`);
  return value;
};

const actionBinding = (
  context: WorkflowExecuteActionContext | WorkflowDryRunActionContext,
  step: WorkflowActionStep,
  field: string,
): WorkflowJsonValue | undefined => context.plan.bindings[workflowPathKey([...step.sourcePath, step.action, field])];

const referenceOrValue = async (
  context: WorkflowExecuteActionContext | WorkflowDryRunActionContext,
  value: WorkflowJsonValue | undefined,
): Promise<WorkflowJsonValue | undefined> => {
  if (typeof value === "string" && !value.includes("${{")) {
    const referenced = await context.resolveReference(value);
    if (referenced !== undefined) return referenced;
  }
  return value === undefined ? undefined : context.evaluate(value);
};

const executionError = (error: unknown, fallbackCode = "MAIL_WORKFLOW_ACTION_FAILED") => ({
  code: typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : fallbackCode,
  message: error instanceof Error ? error.message : String(error),
  retryable: false,
});

const lockCollaborationActionFence = async (db: SqlClient, context: WorkflowExecuteActionContext): Promise<void> => {
  const [target] = await db<{ id: string }[]>`
    SELECT target.id
    FROM mail.workflow_run_targets target
    JOIN mail.workflow_step_runs step
      ON step.target_id = target.id
     AND step.step_key = ${context.step.key}
     AND step.execution_generation = ${context.run.executionGeneration}
    WHERE target.id = ${context.run.runId}::uuid
      AND target.state = 'running'
      AND target.execution_generation = ${context.run.executionGeneration}
      AND target.lease_expires_at >= now()
      AND target.cancel_requested_at IS NULL
    FOR UPDATE OF target
  `;
  if (!target) {
    throw Object.assign(new Error("Workflow execution lease was lost before collaboration mutation"), {
      code: "MAIL_WORKFLOW_LEASE_LOST",
    });
  }
};

const ledgerCompletedCollaborationAction = async (
  db: SqlClient,
  context: WorkflowExecuteActionContext,
  outcome: Extract<WorkflowStepOutcome, { state: "completed" }>,
): Promise<void> => {
  const rows = await db<{ step_key: string }[]>`
    UPDATE mail.workflow_step_runs
    SET
      state = 'succeeded',
      outcome = ${{ mode: "execute", outcome }}::jsonb,
      dependency = NULL,
      finished_at = now()
    WHERE target_id = ${context.run.runId}::uuid
      AND step_key = ${context.step.key}
      AND execution_generation = ${context.run.executionGeneration}
    RETURNING step_key
  `;
  if (rows.length === 0) {
    throw Object.assign(new Error("Workflow execution lease was lost before collaboration completion"), {
      code: "MAIL_WORKFLOW_LEASE_LOST",
    });
  }
};

const commandOutcome = (command: MailCommand): WorkflowStepOutcome => {
  const output = { commandId: command.id, state: command.state };
  if (command.state === "confirmed" || command.state === "reconciled") return { state: "completed", output };
  if (command.state === "needs_attention") {
    return {
      state: "needs_attention",
      error: { code: "MAIL_COMMAND_NEEDS_ATTENTION", message: command.lastError ?? "Mail command needs attention", retryable: false },
    };
  }
  if (command.state === "failed" || command.state === "cancelled") {
    return {
      state: "failed",
      error: { code: "MAIL_COMMAND_FAILED", message: command.lastError ?? `Mail command ${command.state}`, retryable: false },
    };
  }
  return { state: "waiting", dependency: { kind: "mail.command", key: command.id } };
};

const completedNoop = (action: string): Extract<WorkflowStepOutcome, { state: "completed" }> => ({
  state: "completed",
  output: { action, applied: false },
});

const messageTransition = async (
  context: WorkflowExecuteActionContext,
  step: WorkflowActionStep,
): Promise<{
  message: JsonObject;
  action: "addKeyword" | "removeKeyword" | "moveMessage";
  value: WorkflowJsonValue;
}> => {
  if (step.action !== "addKeyword" && step.action !== "removeKeyword" && step.action !== "moveMessage") {
    throw new Error(`Unsupported message transition ${step.action}`);
  }
  const message = objectValue(await referenceOrValue(context, step.config.message), "message");
  if (step.action === "moveMessage") {
    return {
      message,
      action: step.action,
      value: textValue(actionBinding(context, step, "folder") ?? (await referenceOrValue(context, step.config.folder)), "folder"),
    };
  }
  return {
    message,
    action: step.action,
    value: textValue(await referenceOrValue(context, step.config.keyword), "keyword"),
  };
};

const conversationTransition = async (
  context: WorkflowExecuteActionContext,
  step: WorkflowActionStep,
): Promise<{
  conversation: JsonObject;
  action: "assignConversation" | "setConversationStatus";
  value: WorkflowJsonValue;
}> => {
  if (step.action !== "assignConversation" && step.action !== "setConversationStatus") {
    throw new Error(`Unsupported conversation transition ${step.action}`);
  }
  const conversation = objectValue(await referenceOrValue(context, step.config.conversation), "conversation");
  if (step.action === "assignConversation") {
    const value = actionBinding(context, step, "user") ?? (await referenceOrValue(context, step.config.user)) ?? null;
    if (value !== null && typeof value !== "string") throw new Error("user must resolve to text or null");
    return { conversation, action: step.action, value };
  }
  const value = textValue(await referenceOrValue(context, step.config.status), "status");
  if (value !== "open" && value !== "waiting" && value !== "done") throw new Error("status is invalid");
  return { conversation, action: step.action, value };
};

const remoteState = (preconditions: WorkflowJsonValue): RemoteMessagePrecondition | undefined => {
  if (!isJsonObject(preconditions)) return undefined;
  const value = preconditions.remoteState;
  return isJsonObject(value) ? (value as RemoteMessagePrecondition) : undefined;
};

const commandInput = async (
  context: WorkflowExecuteActionContext | WorkflowDryRunActionContext,
  step: WorkflowActionStep,
  options: MailWorkflowRuntimeActionOptions,
): Promise<ActorCommandInput> => {
  const message = objectValue(await referenceOrValue(context, step.config.message), "message");
  const remoteMessageRefId = textValue(message.remoteMessageRefId, "message.remoteMessageRefId");
  const folderId = textValue(message.folderId, "message.folderId");
  const idempotencyKey = `workflow:${options.targetId}:${sha256Text(context.step.key).slice(0, 40)}`;
  const expectedRemoteState = remoteState(options.preconditions);
  if (step.action === "moveMessage") {
    const destinationFolderId = textValue(
      actionBinding(context, step, "folder") ?? (await referenceOrValue(context, step.config.folder)),
      "folder",
    );
    return {
      kind: "move",
      remoteMessageRefId,
      sourceFolderId: folderId,
      destinationFolderId,
      idempotencyKey,
      correlationId: options.targetId,
      ...(expectedRemoteState ? { expectedRemoteState } : {}),
    };
  }
  const keyword = textValue(await referenceOrValue(context, step.config.keyword), "keyword");
  return {
    kind: "change_message_state",
    remoteMessageRefId,
    folderId,
    change: {
      addFlags: [],
      removeFlags: [],
      addKeywords: step.action === "addKeyword" ? [keyword] : [],
      removeKeywords: step.action === "removeKeyword" ? [keyword] : [],
    },
    idempotencyKey,
    correlationId: options.targetId,
    ...(expectedRemoteState ? { expectedRemoteState } : {}),
  };
};

const plannedEffect = async (
  context: WorkflowDryRunActionContext,
  step: WorkflowActionStep,
  options: MailWorkflowRuntimeActionOptions,
): Promise<WorkflowPlanningOutcome> => {
  if (step.action === "addKeyword" || step.action === "removeKeyword" || step.action === "moveMessage") {
    return { state: "planned", effects: [{ kind: "mail.command", input: await commandInput(context, step, options) }] };
  }
  const subject = await referenceOrValue(context, step.config.conversation);
  const value =
    step.action === "assignConversation"
      ? (actionBinding(context, step, "user") ?? (await referenceOrValue(context, step.config.user)) ?? null)
      : await referenceOrValue(context, step.config.status);
  return { state: "planned", effects: [{ kind: `mail.${step.action}`, subject: subject ?? null, value: value ?? null }] };
};

export const createMailWorkflowActionPorts = (
  options: MailWorkflowRuntimeActionOptions,
): { execute: WorkflowExecuteActionPort; dryRun: WorkflowDryRunActionPort } => {
  const conversationRevisions = new Map<string, number>();
  const builtins = createWorkflowBuiltinActionPorts({
    authorize: async () => {
      return (await activeWorkflowAuthority(options))
        ? undefined
        : { code: "FORBIDDEN", message: "Workflow execution authority is no longer active", retryable: false };
    },
  });

  const execute = async (context: WorkflowExecuteActionContext, step: WorkflowActionStep): Promise<WorkflowStepOutcome> => {
    try {
      if (!(await activeWorkflowAuthority(options))) {
        return {
          state: "failed",
          error: { code: "FORBIDDEN", message: "Workflow execution authority is no longer active", retryable: false },
        };
      }
      if (step.action === "addKeyword" || step.action === "removeKeyword" || step.action === "moveMessage") {
        const transition = await messageTransition(context, step);
        if (!mailMessageTransitionChanges(transition.message, transition.action, transition.value)) {
          return completedNoop(step.action);
        }
        const command = await createWorkflowCommand({
          context: options.authority.kind === "actor" ? options.authority.context : null,
          mailboxId: options.mailboxId,
          workflowVersionId: options.workflowVersionId,
          input: await commandInput(context, step, options),
          beforeCreate: async (tx) => {
            await lockCollaborationActionFence(tx, context);
            if (!(await activeWorkflowAuthority(options, tx))) {
              throw Object.assign(new Error("Workflow execution authority is no longer valid"), { code: "FORBIDDEN" });
            }
          },
          afterCreate: async (tx, created) => {
            const linked = await tx<{ step_key: string }[]>`
              UPDATE mail.workflow_step_runs
              SET command_id = ${created.id}::uuid
              WHERE target_id = ${context.run.runId}::uuid
                AND step_key = ${context.step.key}
                AND execution_generation = ${context.run.executionGeneration}
                AND state = 'running'
              RETURNING step_key
            `;
            if (linked.length === 0) {
              throw Object.assign(new Error("Workflow execution lease was lost before linking its mail command"), {
                code: "MAIL_WORKFLOW_LEASE_LOST",
              });
            }
          },
        });
        if (!command.ok) return { state: "failed", error: executionError(command.error) };
        const outcome = commandOutcome(command.data);
        if (outcome.state !== "completed") return outcome;
        applyMailMessageTransition(transition.message, transition.action, transition.value);
        return {
          ...outcome,
          output: { ...(isMailWorkflowProjectedObject(outcome.output) ? outcome.output : {}), action: step.action, applied: true },
        };
      }

      const transition = await conversationTransition(context, step);
      if (!mailConversationTransitionChanges(transition.conversation, transition.action, transition.value)) {
        return completedNoop(step.action);
      }
      const conversation = transition.conversation;
      const conversationId = textValue(conversation.id, "conversation.id");
      const frozenRevision = Number(conversation.revision);
      const expectedRevision = conversationRevisions.get(conversationId) ?? frozenRevision;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) {
        return {
          state: "failed",
          error: { code: "MAIL_CONVERSATION_REVISION_MISSING", message: "Conversation revision is unavailable", retryable: false },
        };
      }
      const input: UpdateConversationCollaboration = await (async () => {
        if (step.action === "assignConversation") {
          return { expectedRevision, assigneeUserId: transition.value as string | null };
        }
        return { expectedRevision, workStatus: transition.value as "open" | "waiting" | "done" };
      })();
      const completed = await sql.begin(async (tx) => {
        await lockCollaborationActionFence(tx, context);
        if (!(await activeWorkflowAuthority(options, tx))) {
          throw Object.assign(new Error("Workflow execution authority is no longer valid"), { code: "FORBIDDEN" });
        }
        const activityMetadata = { workflowTargetId: options.targetId, workflowStepKey: context.step.key };
        const mutation =
          options.authority.kind === "actor"
            ? await updateConversationCollaborationInTransaction({
                context: options.authority.context,
                mailboxId: options.mailboxId,
                conversationId,
                input,
                db: tx,
                actorOverride: { kind: "workflow", workflowVersionId: options.workflowVersionId },
                activityMetadata,
              })
            : await updateWorkflowConversationCollaborationInTransaction({
                mailboxId: options.mailboxId,
                workflowVersionId: options.workflowVersionId,
                conversationId,
                input,
                db: tx,
                activityMetadata,
              });
        if (!mutation.ok) return { mutation, outcome: null };
        const outcome: Extract<WorkflowStepOutcome, { state: "completed" }> = {
          state: "completed",
          output: { conversationId, revision: mutation.data.value.revision, action: step.action, applied: true },
        };
        await ledgerCompletedCollaborationAction(tx, context, outcome);
        return { mutation, outcome };
      });
      if (!completed.mutation.ok) return { state: "failed", error: executionError(completed.mutation.error) };
      if (!completed.outcome) throw new Error("Completed collaboration action outcome is unavailable");
      conversationRevisions.set(conversationId, completed.mutation.data.value.revision);
      applyMailConversationTransition(conversation, transition.action, transition.value);
      conversation.revision = completed.mutation.data.value.revision;
      if (completed.mutation.data.event) await publishMailCollaborationEvent(completed.mutation.data.event);
      return completed.outcome;
    } catch (error) {
      return { state: "failed", error: executionError(error) };
    }
  };

  const restoreCompleted = async (
    context: WorkflowExecuteActionContext,
    step: WorkflowActionStep,
    outcome: { output?: WorkflowJsonValue },
  ) => {
    if (!isJsonObject(outcome.output) || outcome.output.applied !== true) return;
    if (step.action === "addKeyword" || step.action === "removeKeyword" || step.action === "moveMessage") {
      const transition = await messageTransition(context, step);
      applyMailMessageTransition(transition.message, transition.action, transition.value);
      return;
    }
    const transition = await conversationTransition(context, step);
    applyMailConversationTransition(transition.conversation, transition.action, transition.value);
    const conversationId = outcome.output.conversationId;
    const revision = outcome.output.revision;
    if (typeof conversationId === "string" && typeof revision === "number") {
      transition.conversation.revision = revision;
      conversationRevisions.set(conversationId, revision);
    }
  };

  return {
    execute: {
      get: (action) =>
        ["addKeyword", "removeKeyword", "moveMessage", "assignConversation", "setConversationStatus"].includes(action)
          ? { execute, restoreCompleted }
          : builtins.execute.get(action),
    },
    dryRun: {
      get: (action) =>
        ["addKeyword", "removeKeyword", "moveMessage", "assignConversation", "setConversationStatus"].includes(action)
          ? { plan: (context, step) => plannedEffect(context, step, options) }
          : builtins.dryRun.get(action),
    },
  };
};
