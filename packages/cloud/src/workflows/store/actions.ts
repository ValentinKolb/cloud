/**
 * Turns an app's declared actions into something the executor can run.
 *
 * This is what makes "an app brings only actions" true rather than aspirational.
 * Without it, every app would hand-wire the same four things around every
 * external call: resolve the config, charge the budget, mark the effect as
 * started, settle it afterwards. Both apps did, slightly differently, which is
 * how one of them ended up with no budget at all.
 *
 * The budget is charged from the action's own `plan` hook — the same hook a dry
 * run uses. That is the point: preflight and execution cannot disagree about
 * what an action costs, because one function answers for both. Mail's known
 * defect was exactly that divergence, and here it is not a bug to fix but a
 * shape that cannot occur.
 */
import { type SQL, sql } from "bun";
import type { WorkflowJsonValue, WorkflowStepOutcome } from "../contracts";
import { type ErasedWorkflowAction, LANGUAGE_EFFECT, type WorkflowActionMap } from "../definition";
import type {
  WorkflowActionStep,
  WorkflowDryRunActionContext,
  WorkflowDryRunActionPort,
  WorkflowExecuteActionContext,
  WorkflowExecuteActionPort,
} from "../runtime/ports";
import { budgetError, budgetRootRunId, chargeWorkflowEffectBudget } from "./budget";
import { beginWorkflowEffect, readWorkflowEffect, recordWorkflowEffect, settleWorkflowEffect } from "./runs";
import { withTransaction } from "./transaction";

/**
 * The key an idempotent effect deduplicates on.
 *
 * Derived from the run and step rather than generated, so a replay after a
 * crash presents the provider with the same key and gets the same answer
 * instead of performing the work twice.
 */
export const workflowEffectKey = (runId: string, stepKey: string): string => `workflow:${runId}:step:${stepKey}`;

/** Unwinds a transactional action's transaction while keeping its message. */
class WorkflowTransactionalFailure extends Error {}

const asError = (message: string, retryable = false): Extract<WorkflowStepOutcome, { state: "failed" }>["error"] =>
  ({ code: "WORKFLOW_ACTION_ERROR", message, retryable }) as Extract<WorkflowStepOutcome, { state: "failed" }>["error"];

/**
 * Resolves a step's written config into the values the implementation receives.
 *
 * References in the config — `{{ steps.foo.output }}` and friends — are what the
 * workflow language exists for, so they have to be evaluated before the action
 * ever sees them. The action's parameter type is derived from its schema, which
 * is what keeps the two honest.
 */
const resolveConfig = async (
  ctx: { evaluate(value: WorkflowJsonValue, path?: Array<string | number>): Promise<WorkflowJsonValue> },
  step: WorkflowActionStep,
): Promise<Record<string, WorkflowJsonValue>> => {
  const resolved = await ctx.evaluate(step.config as WorkflowJsonValue, ["config"]);
  return (resolved && typeof resolved === "object" && !Array.isArray(resolved) ? resolved : {}) as Record<string, WorkflowJsonValue>;
};

/** The context an action implementation receives, built once per invocation. */
const actionContext = (ctx: WorkflowExecuteActionContext, effectKey: string, tx?: SQL) => ({
  runId: ctx.run.runId,
  effectKey,
  ...(tx ? { tx } : {}),
  heartbeat: async (): Promise<void> => {
    await ctx.heartbeat();
  },
});

/** Refused access is a failure of this step, not of the whole run. */
const denied = (): WorkflowStepOutcome => ({ state: "failed", error: asError("not authorized to perform this action") });

export type WorkflowActionPortOptions = {
  /** Charged against the root of a fan-out, so children share one allowance. */
  budget?: boolean;
  db?: SQL;
};

/**
 * Runs one declared action, with everything its effect class implies.
 *
 * The order is the contract: plan, then charge, then mark, then act, then
 * settle. Charging before acting is the only ordering that cannot overspend,
 * and marking before acting is the only one that leaves evidence when the
 * process dies mid-effect.
 */
const runDeclaredAction = async (
  action: ErasedWorkflowAction,
  ctx: WorkflowExecuteActionContext,
  step: WorkflowActionStep,
  options: WorkflowActionPortOptions,
): Promise<WorkflowStepOutcome> => {
  const config = await resolveConfig(ctx, step);
  const journalStep = { runId: ctx.run.runId, key: ctx.step.key, executionGeneration: ctx.run.executionGeneration };
  const effectKey = workflowEffectKey(ctx.run.runId, ctx.step.key);

  /*
   * An earlier attempt of this step may have escaped without telling us how it
   * ended. Re-running is how the same message goes out twice, so ask the
   * external system instead — that is the entire reason `reconcile` is
   * mandatory for this class.
   *
   * Only ambiguous actions need it. A transactional effect was undone by the
   * crash that interrupted it, and an idempotent one is safe to repeat under
   * the same key.
   */
  if (action.effect === "ambiguous" && action.reconcile) {
    const prior = await readWorkflowEffect(journalStep, { db: options.db });
    if (prior && (prior.state === "executing" || prior.state === "ambiguous")) {
      const verdict = await action.reconcile(actionContext(ctx, prior.key), prior.key);
      if (verdict.state === "succeeded") {
        await settleWorkflowEffect(journalStep, "succeeded", { db: options.db });
        return { state: "completed", output: (verdict.output ?? null) as WorkflowJsonValue };
      }
      if (verdict.state === "failed") {
        await settleWorkflowEffect(journalStep, "failed", { db: options.db });
        return { state: "failed", error: asError(verdict.message) };
      }
      // Still unknown. A human decides; nothing is repeated on their behalf.
      await settleWorkflowEffect(journalStep, "ambiguous", { db: options.db });
      return { state: "needs_attention", error: asError(verdict.message) };
    }
  }

  /*
   * A transactional action performs its work and records that it happened in
   * one transaction, so a crash leaves neither. A replay therefore finds the
   * recorded outcome and returns it instead of doing the work a second time.
   */
  if (action.effect === "transactional") {
    const prior = await readWorkflowEffect(journalStep, { db: options.db });
    if (prior?.state === "succeeded") return { state: "completed", output: prior.output };

    if (action.plan && options.budget !== false) {
      const planned = await action.plan(actionContext(ctx, effectKey), config as never);
      if (planned.consumes && Object.keys(planned.consumes).length > 0) {
        const root = await budgetRootRunId(ctx.run.runId, { db: options.db });
        const charge = await chargeWorkflowEffectBudget(root, planned.consumes, { db: options.db });
        if (charge.state === "exceeded") return { state: "failed", error: asError(budgetError(charge).message) };
      }
    }

    return withTransaction(options.db, async (tx) => {
      const txCtx = actionContext(ctx, effectKey, tx);
      // Checked on the transaction's own handle: access can be revoked between
      // queueing and running, and a check on another connection is checking a
      // world this write will not see.
      if (action.authorize && !(await action.authorize(txCtx, config as never))) return denied();

      const result = await action.run(txCtx, config as never);
      if (result.state !== "succeeded") {
        // Let the transaction unwind: the effect did not happen.
        throw new WorkflowTransactionalFailure(result.state === "failed" ? result.message : result.message);
      }
      await recordWorkflowEffect(tx, journalStep, effectKey, (result.output ?? null) as WorkflowJsonValue);
      return { state: "completed", output: (result.output ?? null) as WorkflowJsonValue } satisfies WorkflowStepOutcome;
    }).catch((error) => {
      if (error instanceof WorkflowTransactionalFailure)
        return { state: "failed", error: asError(error.message) } satisfies WorkflowStepOutcome;
      throw error;
    });
  }

  if (action.effect !== "pure" && action.plan) {
    const planned = await action.plan(actionContext(ctx, effectKey), config as never);
    // Charged per attempt. A replayed in-flight step charges twice, which is
    // conservative — it can only refuse more, never permit more.
    if (options.budget !== false && planned.consumes && Object.keys(planned.consumes).length > 0) {
      const root = await budgetRootRunId(ctx.run.runId, { db: options.db });
      const charge = await chargeWorkflowEffectBudget(root, planned.consumes, { db: options.db });
      if (charge.state === "exceeded") return { state: "failed", error: asError(budgetError(charge).message) };
    }
  }

  if (action.authorize && !(await action.authorize(actionContext(ctx, effectKey), config as never))) return denied();

  // Only an ambiguous effect needs evidence that it started: the others are
  // either safe to repeat or undone by the crash that interrupted them.
  if (action.effect === "ambiguous") await beginWorkflowEffect(journalStep, effectKey, { db: options.db });

  const result = await action.run(actionContext(ctx, effectKey), config as never);

  if (action.effect === "ambiguous") {
    await settleWorkflowEffect(
      journalStep,
      result.state === "succeeded" ? "succeeded" : result.state === "failed" ? "failed" : "ambiguous",
      {
        db: options.db,
      },
    );
  }

  switch (result.state) {
    case "succeeded":
      return { state: "completed", output: (result.output ?? null) as WorkflowJsonValue };
    case "failed":
      return { state: "failed", error: asError(result.message) };
    case "ambiguous":
      // Not a failure: "the send may have gone through" needs a human, and
      // treating it as failure either loses messages or sends them twice.
      return { state: "needs_attention", error: asError(result.message) };
  }
};

/**
 * The port the worker executes with, built from an app's `workflows.ts`.
 *
 * ```ts
 * import { actions } from "./workflows";
 * tickWorkflows({ worker, appId: "grids", actions: createWorkflowActionPort(actions) });
 * ```
 */
export const createWorkflowActionPort = (
  actions: WorkflowActionMap,
  options: WorkflowActionPortOptions = {},
): WorkflowExecuteActionPort => ({
  get: (name) => {
    const action = actions[name];
    if (!action) return undefined;
    return { execute: (ctx, step) => runDeclaredAction(action, ctx, step, options) };
  },
});

/**
 * The language descriptors an app's actions imply.
 *
 * Derived rather than written a second time: the descriptor and the
 * implementation used to be separate places that could disagree and only fail
 * at runtime.
 */
export const workflowActionDescriptors = (actions: WorkflowActionMap, namespace: string) =>
  Object.entries(actions).map(([key, action]) => ({
    kind: `${namespace}.${key}`,
    label: action.label,
    description: action.description,
    config: action.config,
    effect: LANGUAGE_EFFECT[action.effect],
    ...(action.outputType ? { outputType: action.outputType } : {}),
    // A pure action has nothing to plan, so a dry run reports it in full.
    dryRun: (action.effect === "pure" ? "full" : "validate") as "full" | "validate",
  }));

/**
 * The port a dry run executes with, built from the same declarations.
 *
 * A dry run and a preflight are the same operation: run the plan with impure
 * steps reporting what they *would* do. Because both come from one `plan` hook,
 * what a dry run promises and what execution charges cannot drift apart.
 *
 * A pure action is simply run — it is deterministic and touches nothing, which
 * is what makes its dry run exact rather than a description.
 */
export const createWorkflowDryRunPort = (actions: WorkflowActionMap): WorkflowDryRunActionPort => ({
  get: (name) => {
    const action = actions[name];
    if (!action) return undefined;
    return {
      plan: async (ctx: WorkflowDryRunActionContext, step: WorkflowActionStep) => {
        const config = await resolveConfig(ctx, step);
        const context = {
          runId: ctx.run.runId,
          effectKey: workflowEffectKey(ctx.run.runId, ctx.step.key),
          heartbeat: async () => void (await ctx.heartbeat()),
        };

        if (action.effect === "pure") {
          const result = await action.run(context, config as never);
          return result.state === "succeeded"
            ? { state: "planned" as const, output: (result.output ?? null) as WorkflowJsonValue, effects: [] }
            : { state: "terminal" as const, status: "failed" as const, message: result.message, effects: [] };
        }

        if (!action.plan) return { state: "unsupported" as const, reason: `${name} cannot be planned` };

        const planned = await action.plan(context, config as never);
        return {
          state: "planned" as const,
          output: (planned.output ?? null) as WorkflowJsonValue,
          effects: [
            { action: name, summary: planned.summary, ...(planned.consumes ? { consumes: planned.consumes } : {}) } as WorkflowJsonValue,
          ],
          // An issue names the step it belongs to, so the dry-run view can point
          // at what could not be determined rather than listing loose strings.
          ...(planned.issues?.length
            ? {
                issues: planned.issues.map((reason) => ({
                  state: "indeterminate" as const,
                  reason,
                  step: {
                    key: ctx.step.key,
                    sourcePath: ctx.step.sourcePath,
                    iterationPath: ctx.step.iterationPath,
                    path: ctx.step.path,
                    kind: ctx.step.kind,
                    ...(ctx.step.action ? { action: ctx.step.action } : {}),
                  },
                })),
              }
            : {}),
        };
      },
    };
  },
});
