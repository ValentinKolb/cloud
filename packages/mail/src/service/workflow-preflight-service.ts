import type { WorkflowBoundPlan, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { createWorkflowBuiltinActionPorts, workflowPathKey } from "@valentinkolb/cloud/workflows";
import type {
  WorkflowActionStep,
  WorkflowDryRunActionHandler,
  WorkflowDryRunActionPort,
  WorkflowRuntimeRepositoryPort,
} from "@valentinkolb/cloud/workflows/runtime";
import { dryRunWorkflowPlan } from "@valentinkolb/cloud/workflows/runtime";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { MailWorkflowPreflight, PreflightWorkflowInput, WorkflowEffectBudget } from "../contracts";
import type { MailRequestContext } from "./auth";
import { sha256Json } from "./canonical";
import { resolveMailExecution } from "./execution";
import { validateSearchComplexity } from "./search";
import {
  countWorkflowQueryBodyGaps,
  type FrozenMailWorkflowPreconditions,
  type FrozenMailWorkflowSource,
  listWorkflowSnapshots,
  type MailWorkflowTargetSnapshot,
  type SqlClient,
} from "./workflow-data";
import { loadWorkflowVersion, mapWorkflowVersion } from "./workflow-definition-service";

export const MAX_MAIL_WORKFLOW_TARGETS = 50_000;
export const MAX_MAIL_WORKFLOW_EFFECTS = 50_000;

type PlannedEffect = {
  category: "move" | "keyword" | "collaboration";
  action: string;
  stepPath: Array<string | number>;
};

export type PreparedWorkflowTarget = {
  targetKey: string;
  source: FrozenMailWorkflowSource;
  preconditions: FrozenMailWorkflowPreconditions;
  inputs: Record<string, WorkflowJsonValue>;
};

export type PreparedWorkflowPreflight = {
  preflight: MailWorkflowPreflight;
  actionCounts: Record<string, number>;
  targetDigest: string;
};

type PlanRequirements = {
  body: boolean;
  attachments: boolean;
  conversation: boolean;
};

type WorkflowTargetScan = {
  actionCounts: Record<string, number>;
  targetCount: number;
  targetDigest: string;
};

export type WorkflowTargetCursor = {
  internalDate: string;
  remoteMessageRefId: string;
};

export type PreparedWorkflowTargetBatch = {
  targets: PreparedWorkflowTarget[];
  cursor: WorkflowTargetCursor | null;
  targetDigest: string;
};

export const initialWorkflowTargetDigest = (): string => sha256Json({ kind: "mail-workflow-targets", version: 1 });

const inspectJson = (value: WorkflowJsonValue, requirements: PlanRequirements): void => {
  if (typeof value === "string") {
    requirements.body ||= /\.(?:body|bodyText|bodyHtml)(?:\b|\.)/.test(value);
    requirements.attachments ||= /\.(?:attachments|hasAttachments)(?:\b|\.)/.test(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => inspectJson(item, requirements));
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach((item) => inspectJson(item, requirements));
  }
};

export const workflowPlanRequirements = (plan: WorkflowBoundPlan): PlanRequirements => {
  const requirements: PlanRequirements = { body: false, attachments: false, conversation: false };
  inspectJson(plan.steps as unknown as WorkflowJsonValue, requirements);
  const steps = JSON.stringify(plan.steps);
  for (const input of plan.inputs) {
    if (input.type === "mailConversation" && (input.config.required === true || steps.includes(`inputs.${input.name}`))) {
      requirements.conversation = true;
    }
  }
  return requirements;
};

export const buildFrozenWorkflowInputs = (
  plan: WorkflowBoundPlan,
  source: FrozenMailWorkflowSource,
  invocationInputs: Record<string, WorkflowJsonValue>,
): Record<string, WorkflowJsonValue> => {
  const inputs: Record<string, WorkflowJsonValue> = { ...invocationInputs };
  for (const input of plan.inputs) {
    if (input.type === "mailMessage") inputs[input.name] = source.message;
    else if (input.type === "mailConversation") inputs[input.name] = source.conversation;
  }
  return inputs;
};

const jsonRecord = (value: WorkflowJsonValue): Record<string, WorkflowJsonValue> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;

const boundConfigValue = (plan: WorkflowBoundPlan, step: WorkflowActionStep, field: string): WorkflowJsonValue | undefined =>
  plan.bindings[workflowPathKey([...step.sourcePath, step.action, field])];

const planned = (effect?: PlannedEffect) => ({
  state: "planned" as const,
  effects: effect ? ([effect] as WorkflowJsonValue[]) : [],
});

const messageAction = (
  category: PlannedEffect["category"],
  apply: (message: Record<string, WorkflowJsonValue>, value: WorkflowJsonValue, step: WorkflowActionStep) => boolean,
  value: (
    context: Parameters<WorkflowDryRunActionHandler["plan"]>[0],
    step: WorkflowActionStep,
  ) => WorkflowJsonValue | undefined | Promise<WorkflowJsonValue | undefined>,
): WorkflowDryRunActionHandler => ({
  plan: async (context, step) => {
    const message = jsonRecord(await context.evaluate(step.config.message ?? null));
    if (!message) return { state: "indeterminate", reason: `${step.action} requires a frozen Mail message` };
    const actionValue = await value(context, step);
    if (actionValue === undefined) return { state: "indeterminate", reason: `${step.action} has no bound value` };
    return planned(apply(message, actionValue, step) ? { category, action: step.action, stepPath: step.sourcePath } : undefined);
  },
});

const keywordAction = (add: boolean): WorkflowDryRunActionHandler =>
  messageAction(
    "keyword",
    (message, value) => {
      if (typeof value !== "string") return false;
      const current = Array.isArray(message.keywords) ? message.keywords.filter((item): item is string => typeof item === "string") : [];
      const index = current.findIndex((item) => item.toLowerCase() === value.toLowerCase());
      if (add && index < 0) {
        message.keywords = [...current, value].sort();
        return true;
      }
      if (!add && index >= 0) {
        message.keywords = current.filter((_, itemIndex) => itemIndex !== index);
        return true;
      }
      return false;
    },
    (context, step) => (step.config.keyword === undefined ? undefined : context.evaluate(step.config.keyword)),
  );

const moveAction = messageAction(
  "move",
  (message, value) => {
    if (typeof value !== "string" || message.folderId === value) return false;
    message.folderId = value;
    return true;
  },
  (context, step) => {
    const bound = boundConfigValue(context.plan, step, "folder");
    return bound ?? (step.config.folder === undefined ? undefined : context.evaluate(step.config.folder));
  },
);

const conversationAction = (
  apply: (conversation: Record<string, WorkflowJsonValue>, value: WorkflowJsonValue) => boolean,
  value: (
    context: Parameters<WorkflowDryRunActionHandler["plan"]>[0],
    step: WorkflowActionStep,
  ) => WorkflowJsonValue | undefined | Promise<WorkflowJsonValue | undefined>,
): WorkflowDryRunActionHandler => ({
  plan: async (context, step) => {
    const conversation = jsonRecord(await context.evaluate(step.config.conversation ?? null));
    if (!conversation) return { state: "indeterminate", reason: `${step.action} requires a frozen Mail conversation` };
    const actionValue = await value(context, step);
    if (actionValue === undefined) return { state: "indeterminate", reason: `${step.action} has no bound value` };
    return planned(
      apply(conversation, actionValue) ? { category: "collaboration", action: step.action, stepPath: step.sourcePath } : undefined,
    );
  },
});

const assignAction = conversationAction(
  (conversation, value) => {
    if ((typeof value !== "string" && value !== null) || conversation.assigneeUserId === value) return false;
    conversation.assigneeUserId = value;
    conversation.revision = Number(conversation.revision ?? 0) + 1;
    return true;
  },
  (context, step) => {
    const bound = boundConfigValue(context.plan, step, "user");
    return bound ?? (step.config.user === undefined ? undefined : context.evaluate(step.config.user));
  },
);

const statusAction = conversationAction(
  (conversation, value) => {
    if (typeof value !== "string" || conversation.workStatus === value) return false;
    conversation.status = value;
    conversation.workStatus = value;
    if (value === "done") conversation.responseNeeded = false;
    conversation.revision = Number(conversation.revision ?? 0) + 1;
    return true;
  },
  (context, step) => (step.config.status === undefined ? undefined : context.evaluate(step.config.status)),
);

const planners = new Map<string, WorkflowDryRunActionHandler>([
  ["addKeyword", keywordAction(true)],
  ["removeKeyword", keywordAction(false)],
  ["moveMessage", moveAction],
  ["assignConversation", assignAction],
  ["setConversationStatus", statusAction],
]);

const builtinPlanningActions = createWorkflowBuiltinActionPorts({ authorize: async () => undefined }).dryRun;
const planningActions: WorkflowDryRunActionPort = { get: (action) => planners.get(action) ?? builtinPlanningActions.get(action) };
const planningRepository: WorkflowRuntimeRepositoryPort = {
  heartbeat: async () => ({ state: "active" }),
  restoreStepOutcome: async () => null,
  startStep: async () => undefined,
  finishStep: async () => undefined,
  parkStep: async () => undefined,
};

export const planFrozenWorkflowTarget = async (params: {
  workflowId: string;
  versionIdentity: string;
  plan: WorkflowBoundPlan;
  source: FrozenMailWorkflowSource;
  inputs: Record<string, WorkflowJsonValue>;
  occurredAt: string;
}): Promise<Result<PlannedEffect[]>> => {
  const projectedSource = structuredClone(params.source);
  const projectedInputs = buildFrozenWorkflowInputs(params.plan, projectedSource, params.inputs);
  const result = await dryRunWorkflowPlan({
    runId: crypto.randomUUID(),
    executionGeneration: 0,
    plan: params.plan,
    invocation: {
      workflowId: params.workflowId,
      mode: "dryRun",
      channel: "bulk",
      actor: {},
      inputs: projectedInputs,
      idempotencyKey: `preflight:${params.versionIdentity}`,
      occurredAt: params.occurredAt,
      context: projectedSource,
    },
    repository: planningRepository,
    actions: planningActions,
    clock: { now: () => params.occurredAt },
  });
  if (result.state === "unsupported" || result.state === "indeterminate" || result.state === "canceled") {
    return fail(err.badInput(`Workflow preflight is ${result.state}: ${"reason" in result ? result.reason : "canceled"}`));
  }
  return ok(result.effects as PlannedEffect[]);
};

export const workflowEffectBudgetExceeded = (
  counts: Record<string, number>,
  targetCount: number,
  budget: WorkflowEffectBudget,
): boolean => {
  const moves = counts.moveMessage ?? 0;
  const keywords = (counts.addKeyword ?? 0) + (counts.removeKeyword ?? 0);
  const collaboration = (counts.assignConversation ?? 0) + (counts.setConversationStatus ?? 0);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return (
    targetCount > budget.maxTargets ||
    targetCount > MAX_MAIL_WORKFLOW_TARGETS ||
    moves > budget.maxMoves ||
    keywords > budget.maxKeywordChanges ||
    collaboration > budget.maxCollaborationChanges ||
    total > MAX_MAIL_WORKFLOW_EFFECTS
  );
};

const prepareWorkflowTargets = async (params: {
  snapshots: MailWorkflowTargetSnapshot[];
  workflowId: string;
  versionIdentity: string;
  plan: WorkflowBoundPlan;
  requirements: PlanRequirements;
  invocationInputs: Record<string, WorkflowJsonValue>;
  occurredAt: string;
  targetDigest: string;
  actionCounts?: Record<string, number>;
}): Promise<Result<{ targets: PreparedWorkflowTarget[]; targetDigest: string }>> => {
  const targets: PreparedWorkflowTarget[] = [];
  let targetDigest = params.targetDigest;
  for (const snapshot of params.snapshots) {
    if (params.requirements.body && !snapshot.source.message.bodyAvailable) {
      return fail(err.conflict("Workflow target body data must be hydrated before preflight"));
    }
    if (params.requirements.attachments && !snapshot.source.message.attachmentsAvailable) {
      return fail(err.conflict("Workflow target attachment data must be hydrated before preflight"));
    }
    if (params.requirements.conversation && !snapshot.source.conversation) {
      return fail(err.conflict("Workflow target conversation data is unavailable"));
    }
    if (params.actionCounts) {
      const effects = await planFrozenWorkflowTarget({
        workflowId: params.workflowId,
        versionIdentity: params.versionIdentity,
        plan: params.plan,
        source: snapshot.source,
        inputs: params.invocationInputs,
        occurredAt: params.occurredAt,
      });
      if (!effects.ok) return effects;
      for (const effect of effects.data) params.actionCounts[effect.action] = (params.actionCounts[effect.action] ?? 0) + 1;
    }
    const target = {
      targetKey: snapshot.targetKey,
      source: snapshot.source,
      preconditions: snapshot.preconditions,
      inputs: buildFrozenWorkflowInputs(params.plan, snapshot.source, params.invocationInputs),
    };
    targetDigest = sha256Json({
      previous: targetDigest,
      target: {
        targetKey: target.targetKey,
        sourceHash: target.preconditions.sourceHash,
        preconditions: target.preconditions,
        inputs: target.inputs,
      },
    });
    targets.push(target);
  }
  return ok({ targets, targetDigest });
};

const scanWorkflowTargets = async (params: {
  mailboxId: string;
  query: PreflightWorkflowInput["query"];
  invocationInputs: Record<string, WorkflowJsonValue>;
  workflowId: string;
  versionIdentity: string;
  plan: WorkflowBoundPlan;
  requirements: PlanRequirements;
  effectBudget: WorkflowEffectBudget;
  occurredAt: string;
  db: SqlClient;
  planEffects: boolean;
  onBatch?: (targets: PreparedWorkflowTarget[], ordinal: number) => Promise<void>;
}): Promise<Result<WorkflowTargetScan>> => {
  const actionCounts: Record<string, number> = {};
  const maxTargets = Math.min(params.effectBudget.maxTargets, MAX_MAIL_WORKFLOW_TARGETS);
  let targetCount = 0;
  let targetDigest = initialWorkflowTargetDigest();
  let after: WorkflowTargetCursor | null = null;

  while (targetCount <= maxTargets) {
    const limit = Math.min(1_000, maxTargets + 1 - targetCount);
    if (limit <= 0) break;
    const snapshots = await listWorkflowSnapshots({
      mailboxId: params.mailboxId,
      query: params.query,
      limit,
      after,
      db: params.db,
    });
    if (snapshots.length === 0) break;

    const prepared = await prepareWorkflowTargets({
      snapshots,
      workflowId: params.workflowId,
      versionIdentity: params.versionIdentity,
      plan: params.plan,
      requirements: params.requirements,
      invocationInputs: params.invocationInputs,
      occurredAt: params.occurredAt,
      targetDigest,
      actionCounts: params.planEffects ? actionCounts : undefined,
    });
    if (!prepared.ok) return prepared;
    targetDigest = prepared.data.targetDigest;
    await params.onBatch?.(prepared.data.targets, targetCount);
    targetCount += prepared.data.targets.length;
    const last = snapshots.at(-1)!;
    after = { internalDate: last.internalDate, remoteMessageRefId: last.targetKey };
    if (snapshots.length < limit) break;
  }
  return ok({ actionCounts, targetCount, targetDigest });
};

export const prepareWorkflowTargetBatch = async (params: {
  mailboxId: string;
  workflowId: string;
  versionIdentity: string;
  plan: WorkflowBoundPlan;
  inputs: Record<string, WorkflowJsonValue>;
  query: PreflightWorkflowInput["query"];
  occurredAt: string;
  targetDigest: string;
  after: WorkflowTargetCursor | null;
  limit: number;
  db: SqlClient;
}): Promise<Result<PreparedWorkflowTargetBatch>> => {
  const requirements = workflowPlanRequirements(params.plan);
  const snapshots = await listWorkflowSnapshots({
    mailboxId: params.mailboxId,
    query: params.query,
    limit: params.limit,
    after: params.after,
    db: params.db,
  });
  const prepared = await prepareWorkflowTargets({
    snapshots,
    workflowId: params.workflowId,
    versionIdentity: params.versionIdentity,
    plan: params.plan,
    requirements,
    invocationInputs: params.inputs,
    occurredAt: params.occurredAt,
    targetDigest: params.targetDigest,
  });
  if (!prepared.ok) return prepared;
  const last = snapshots.at(-1);
  return ok({
    targets: prepared.data.targets,
    cursor: last ? { internalDate: last.internalDate, remoteMessageRefId: last.targetKey } : params.after,
    targetDigest: prepared.data.targetDigest,
  });
};

export const streamPreparedWorkflowTargets = async (params: {
  mailboxId: string;
  workflowId: string;
  versionIdentity: string;
  plan: WorkflowBoundPlan;
  effectBudget: WorkflowEffectBudget;
  inputs: Record<string, WorkflowJsonValue>;
  query: PreflightWorkflowInput["query"];
  occurredAt: string;
  db: SqlClient;
  onBatch: (targets: PreparedWorkflowTarget[], ordinal: number) => Promise<void>;
}): Promise<Result<{ targetCount: number; targetDigest: string }>> => {
  const scanned = await scanWorkflowTargets({
    ...params,
    invocationInputs: params.inputs,
    requirements: workflowPlanRequirements(params.plan),
    planEffects: false,
  });
  return scanned.ok ? ok({ targetCount: scanned.data.targetCount, targetDigest: scanned.data.targetDigest }) : scanned;
};

export const prepareWorkflowPreflight = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  input: PreflightWorkflowInput;
  occurredAt: string;
  db: SqlClient;
}): Promise<Result<PreparedWorkflowPreflight>> => {
  if (params.input.query.type === "search") {
    const complexity = validateSearchComplexity(params.input.query.expression);
    if (!complexity.ok) return fail(complexity.error);
  }
  const versionRow = await loadWorkflowVersion({
    mailboxId: params.mailboxId,
    workflowId: params.workflowId,
    versionId: params.input.expectedVersionId,
    db: params.db,
  });
  if (!versionRow) return fail(err.notFound("Workflow version"));
  const version = mapWorkflowVersion(versionRow);
  const requirements = workflowPlanRequirements(version.boundPlan);
  const queryBodyGaps = await countWorkflowQueryBodyGaps({
    mailboxId: params.mailboxId,
    query: params.input.query,
    db: params.db,
  });
  if (queryBodyGaps > 0) return fail(err.conflict("Workflow query body data must be hydrated before preflight"));
  const scanned = await scanWorkflowTargets({
    mailboxId: params.mailboxId,
    query: params.input.query,
    invocationInputs: params.input.inputs,
    workflowId: params.workflowId,
    versionIdentity: version.identity,
    plan: version.boundPlan,
    requirements,
    effectBudget: version.effectBudget,
    occurredAt: params.occurredAt,
    db: params.db,
    planEffects: true,
  });
  if (!scanned.ok) return scanned;
  const { actionCounts, targetCount, targetDigest } = scanned.data;
  if (workflowEffectBudgetExceeded(actionCounts, targetCount, version.effectBudget)) {
    return fail(err.badInput("Workflow preflight exceeds its target or effect budget"));
  }
  const queryHash = sha256Json(params.input.query);
  const preflightHash = sha256Json({
    versionId: version.id,
    versionIdentity: version.identity,
    sourceHash: version.sourceHash,
    manifestHash: version.manifestHash,
    catalogHash: version.catalogHash,
    inputs: params.input.inputs,
    occurredAt: params.occurredAt,
    queryHash,
    effectBudget: version.effectBudget,
    actionCounts,
    targetDigest,
    targetCount,
  });
  return ok({
    preflight: {
      workflowVersionId: version.id,
      versionIdentity: version.identity,
      sourceHash: version.sourceHash,
      queryHash,
      preflightHash,
      occurredAt: params.occurredAt,
      effectBudget: version.effectBudget,
      actionCounts,
      targetCount,
    },
    actionCounts,
    targetDigest,
  });
};

export const preflightWorkflow = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  workflowId: string;
  input: PreflightWorkflowInput;
  occurredAt?: string;
}): Promise<Result<MailWorkflowPreflight>> => {
  const allowed = await resolveMailExecution({
    mailboxId: params.mailboxId,
    operation: "actorMutation",
    context: params.context,
  });
  if (!allowed.ok) return allowed;
  const occurredAt = params.occurredAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(occurredAt))) return fail(err.badInput("Workflow occurrence time is invalid"));
  return sql.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    await tx`SET LOCAL statement_timeout = '30s'`;
    const prepared = await prepareWorkflowPreflight({ ...params, occurredAt, db: tx });
    return prepared.ok ? ok(prepared.data.preflight) : prepared;
  });
};
