/**
 * The whole path, end to end: something happens, the kernel notices, a run
 * executes, the outcome is recorded — and a crash halfway through does not
 * repeat the work that already landed.
 *
 * This is the test both apps have to pass before they can delete their own
 * runtimes, so it is written against the kernel alone: the only thing supplied
 * from outside is a bag of action handlers, which is exactly what an app is
 * meant to bring.
 */
import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../../../../core/src/migrate/core/workflows";
import type { WorkflowBoundPlan, WorkflowIrStep } from "../contracts";
import type { WorkflowExecuteActionHandler, WorkflowExecuteActionPort } from "../runtime/ports";
import { createWorkflow, publishWorkflowVersion } from "./definitions";
import { emitWorkflowEvent } from "./events";
import { getWorkflowRun } from "./observability";
import { claimWorkflowRun } from "./runs";
import { runOneWorkflow, tickWorkflows } from "./worker";

let readiness: Promise<boolean> | null = null;
const ready = (): Promise<boolean> => {
  readiness ??= (async () => {
    try {
      await migrate();
      const [row] = await sql<{ run: string | null }[]>`SELECT to_regclass('workflows.run')::text AS run`;
      return Boolean(row?.run);
    } catch {
      return false;
    }
  })();
  return readiness;
};

const hex = (seed: string) => new Bun.CryptoHasher("sha256").update(seed).digest("hex");

const actionStep = (index: number, action: string, config: Record<string, string> = {}): WorkflowIrStep => ({
  kind: "action",
  action,
  config,
  sourcePath: ["steps", index],
});

const planWith = (steps: WorkflowIrStep[], actions: string[]): WorkflowBoundPlan => ({
  schemaVersion: 2,
  languageId: "probe",
  languageVersion: 1,
  sourceHash: hex("source"),
  manifestHash: hex("manifest"),
  catalogHash: hex("catalog"),
  actionPolicies: Object.fromEntries(actions.map((action) => [action, { effect: "transactional" as const, dryRun: "full" as const }])),
  inputs: [],
  triggers: [],
  steps,
  bindings: {},
});

/** An action port over a plain record — what an app's catalogue reduces to. */
const port = (handlers: Record<string, WorkflowExecuteActionHandler["execute"]>): WorkflowExecuteActionPort => ({
  get: (action) => (handlers[action] ? { execute: handlers[action]! } : undefined),
});

const workflowListening = async (eventType: string, plan: WorkflowBoundPlan) => {
  // A fresh app per test: the worker drains by app, and a leftover run from a
  // neighbouring test would otherwise be claimed by a port that cannot serve it.
  const appId = `probe-${crypto.randomUUID().slice(0, 8)}`;
  const scopeId = `scope-${crypto.randomUUID()}`;
  const workflow = await createWorkflow({ appId, scopeId, key: "wf", name: "Probe", author: { kind: "system" } });
  await publishWorkflowVersion({
    workflowId: workflow.id,
    source: "probe",
    sourceHash: plan.sourceHash,
    plan,
    languageId: "probe",
    languageVersion: 1,
    manifestHash: plan.manifestHash,
    author: { kind: "system" },
    activations: [{ key: "t0", eventType }],
  });
  return { appId, scopeId, workflowId: workflow.id };
};

describe("workflow worker", () => {
  test("an event becomes a finished run in one tick", async () => {
    if (!(await ready())) return;
    const plan = planWith([actionStep(0, "probe.record")], ["probe.record"]);
    const { appId, scopeId } = await workflowListening("probe.worker", plan);

    const seen: string[] = [];
    await emitWorkflowEvent({ appId, scopeId, type: "probe.worker", data: { rowId: "r-1" } });

    // Dispatch and execution in the same pass: an event that arrived a moment
    // ago should not have to wait out a poll interval.
    const tick = await tickWorkflows({
      worker: "w1",
      appId,
      actions: port({
        "probe.record": async (ctx) => {
          seen.push(ctx.run.runId);
          return { state: "completed", output: { ok: true } };
        },
      }),
    });

    expect(tick.dispatched).toBeGreaterThanOrEqual(1);
    expect(tick.executed).toBeGreaterThanOrEqual(1);
    expect(seen).toHaveLength(1);

    const detail = await getWorkflowRun(seen[0]!);
    expect(detail?.state).toBe("succeeded");
    expect(detail?.steps.map((step) => step.state)).toEqual(["completed"]);
  });

  test("a failing action settles the run rather than losing it", async () => {
    if (!(await ready())) return;
    const plan = planWith([actionStep(0, "probe.explode")], ["probe.explode"]);
    const { appId, scopeId } = await workflowListening("probe.explode", plan);
    const emission = await emitWorkflowEvent({ appId, scopeId, type: "probe.explode" }, { dispatch: "now" });

    const outcome = await runOneWorkflow({
      worker: "w1",
      runId: emission.runIds[0]!,
      actions: port({
        "probe.explode": async () => ({ state: "failed" as const, error: { code: "boom", message: "provider refused", retryable: false } }),
      }),
    });

    expect(outcome.state).toBe("finished");
    const detail = await getWorkflowRun(emission.runIds[0]!);
    expect(detail?.state).toBe("failed");
    // The failure is on the run, readable without digging through logs.
    expect(JSON.stringify(detail?.error)).toContain("provider refused");
  });

  test("a lost lease mid-run does not repeat the step that already landed", async () => {
    if (!(await ready())) return;
    const plan = planWith([actionStep(0, "probe.first"), actionStep(1, "probe.second")], ["probe.first", "probe.second"]);
    const { appId, scopeId } = await workflowListening("probe.crash", plan);
    const emission = await emitWorkflowEvent({ appId, scopeId, type: "probe.crash" }, { dispatch: "now" });
    const runId = emission.runIds[0]!;

    let firstRuns = 0;
    let secondRuns = 0;
    const handlers = {
      "probe.first": async () => {
        firstRuns += 1;
        return { state: "completed" as const, output: { done: true } };
      },
      "probe.second": async () => {
        secondRuns += 1;
        return { state: "completed" as const };
      },
    };

    // Between the two steps, the worker's lease lapses and someone else claims
    // the run — the generation moves and every write this worker still makes is
    // rejected. That is the shape of a crash, not a thrown handler: an error
    // inside an action is an action failure and settles the run.
    const losing = {
      ...handlers,
      "probe.second": async () => {
        await sql`UPDATE workflows.run SET execution_generation = execution_generation + 1 WHERE id = ${runId}::uuid`;
        return { state: "completed" as const };
      },
    };
    const first = await runOneWorkflow({ worker: "w1", runId, actions: port(losing) });
    expect(first.state).toBe("lost");
    expect(firstRuns).toBe(1);

    // Whoever picks it up next resumes from the journal.
    await sql`
      UPDATE workflows.run SET state = 'queued', retry_after = NULL, lease_owner = NULL, lease_expires_at = NULL WHERE id = ${runId}::uuid
    `;
    const second = await runOneWorkflow({ worker: "w2", runId, actions: port(handlers) });
    expect(second.state).toBe("finished");
    // The whole point of the journal: step one is not run a second time.
    expect(firstRuns).toBe(1);
    expect(secondRuns).toBe(1);
    expect((await getWorkflowRun(runId))?.state).toBe("succeeded");
  });

  test("an idle worker says so instead of spinning", async () => {
    if (!(await ready())) return;
    // An app with nothing queued: the worker reports idle rather than looping.
    expect(await runOneWorkflow({ worker: "w1", appId: `empty-${crypto.randomUUID()}`, actions: port({}) })).toEqual({ state: "idle" });
    expect(await claimWorkflowRun({ worker: "w1", appId: `empty-${crypto.randomUUID()}` })).toBeNull();
  });
});
