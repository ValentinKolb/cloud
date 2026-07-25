/**
 * What an app gets for free by declaring an action instead of wiring one.
 *
 * The ordering assertions are the point: charged before it acts, marked before
 * it acts, settled after. Each of those was hand-written per app before, and
 * the app that got the budget wrong got it wrong by leaving one out.
 */
import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../../../../core/src/migrate/core/workflows";
import type { WorkflowBoundPlan, WorkflowIrStep } from "../contracts";
import { workflowAction } from "../definition";
import { createWorkflowActionPort } from "./actions";
import { createWorkflow, publishWorkflowVersion } from "./definitions";
import { emitWorkflowEvent } from "./events";
import { getWorkflowRun } from "./observability";
import { runOneWorkflow } from "./worker";

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

const CONFIG = { kind: "object", properties: { to: { kind: "string" } } } as const;

const plan = (actions: string[], steps: WorkflowIrStep[]): WorkflowBoundPlan => ({
  schemaVersion: 2,
  languageId: "probe",
  languageVersion: 1,
  sourceHash: hex("source"),
  manifestHash: hex("manifest"),
  catalogHash: hex("catalog"),
  actionPolicies: Object.fromEntries(
    actions.map((action) => [action, { effect: "ambiguous-external" as const, dryRun: "validate" as const }]),
  ),
  inputs: [],
  triggers: [],
  steps,
  bindings: {},
});

const step = (action: string): WorkflowIrStep => ({ kind: "action", action, config: { to: "a@b.c" }, sourcePath: ["steps", 0] });

const queued = async (action: string, effectBudget: Record<string, number> = {}) => {
  const appId = `decl-${crypto.randomUUID().slice(0, 8)}`;
  const scopeId = `scope-${crypto.randomUUID()}`;
  const workflow = await createWorkflow({ appId, scopeId, key: "wf", name: "Declared", author: { kind: "system" } });
  await publishWorkflowVersion({
    workflowId: workflow.id,
    source: "probe",
    sourceHash: hex(scopeId),
    plan: plan([action], [step(action)]),
    languageId: "probe",
    languageVersion: 1,
    manifestHash: hex("manifest"),
    effectBudget,
    author: { kind: "system" },
    activations: [{ key: "t0", eventType: "probe.declared" }],
  });
  const emission = await emitWorkflowEvent({ appId, scopeId, type: "probe.declared" }, { dispatch: "now" });
  return { runId: emission.runIds[0]!, appId };
};

const effectRow = async (runId: string) => {
  const [row] = await sql<{ effect_key: string | null; effect_state: string | null }[]>`
    SELECT effect_key, effect_state FROM workflows.step_outcome WHERE run_id = ${runId}::uuid
  `;
  return row;
};

describe("declared actions", () => {
  test("a pure action runs with its config resolved and no effect recorded", async () => {
    if (!(await ready())) return;
    const { runId } = await queued("probe.format");

    const seen: string[] = [];
    const actions = {
      "probe.format": workflowAction.pure({
        label: "Format",
        description: "Formats.",
        config: CONFIG,
        run: async (_ctx, input) => {
          // The config arrived typed, without the implementation restating it.
          seen.push(input.to);
          return { state: "succeeded", output: { normalized: input.to.toUpperCase() } };
        },
      }),
    };

    expect((await runOneWorkflow({ worker: "w1", runId, actions: createWorkflowActionPort(actions) })).state).toBe("finished");
    expect(seen).toEqual(["a@b.c"]);
    // Nothing left the process, so there is nothing to reconcile.
    expect(await effectRow(runId)).toMatchObject({ effect_key: null, effect_state: null });
  });

  test("an ambiguous action is marked before it acts and settled after", async () => {
    if (!(await ready())) return;
    const { runId } = await queued("probe.send");

    const observed: { effectState?: string | null } = {};
    const actions = {
      "probe.send": workflowAction.ambiguous({
        label: "Send",
        description: "Sends.",
        config: CONFIG,
        run: async (ctx) => {
          // Evidence exists *before* the effect: this is what stops a replay
          // repeating a message that may already have gone out.
          observed.effectState = (await effectRow(ctx.runId))?.effect_state ?? null;
          return { state: "succeeded", output: { id: "m-1" } };
        },
        plan: async () => ({ summary: "send" }),
        reconcile: async () => ({ state: "unknown", message: "" }),
      }),
    };

    await runOneWorkflow({ worker: "w1", runId, actions: createWorkflowActionPort(actions) });
    expect(observed.effectState).toBe("executing");
    expect(await effectRow(runId)).toMatchObject({ effect_state: "succeeded" });
    expect((await getWorkflowRun(runId))?.state).toBe("succeeded");
  });

  test("an ambiguous result needs a human and stays unsettled", async () => {
    if (!(await ready())) return;
    const { runId } = await queued("probe.maybe");

    const actions = {
      "probe.maybe": workflowAction.ambiguous({
        label: "Send",
        description: "Sends.",
        config: CONFIG,
        run: async () => ({ state: "ambiguous", message: "provider timed out after accepting" }),
        plan: async () => ({ summary: "send" }),
        reconcile: async () => ({ state: "unknown", message: "" }),
      }),
    };

    await runOneWorkflow({ worker: "w1", runId, actions: createWorkflowActionPort(actions) });

    // Not a failure: "it may have gone through" is a real answer, and calling
    // it failure either loses the message or sends it twice.
    const detail = await getWorkflowRun(runId);
    expect(detail?.state).toBe("needs_attention");
    expect(await effectRow(runId)).toMatchObject({ effect_state: "ambiguous" });
  });

  test("the budget is charged from the same hook a dry run reads", async () => {
    if (!(await ready())) return;
    const { runId } = await queued("probe.blocked", { emails: 0 });

    let ran = false;
    const actions = {
      "probe.blocked": workflowAction.ambiguous({
        label: "Send",
        description: "Sends.",
        config: CONFIG,
        run: async () => {
          ran = true;
          return { state: "succeeded", output: null };
        },
        plan: async () => ({ summary: "send", consumes: { emails: 1 } }),
        reconcile: async () => ({ state: "unknown", message: "" }),
      }),
    };

    await runOneWorkflow({ worker: "w1", runId, actions: createWorkflowActionPort(actions) });

    // Refused before the effect, not after — and by the same function that
    // answers a dry run, so preflight and execution cannot disagree.
    expect(ran).toBe(false);
    const detail = await getWorkflowRun(runId);
    expect(detail?.state).toBe("failed");
    expect(JSON.stringify(detail?.error)).toContain("effect budget for emails");
  });

  test("an action the app never declared is a missing handler, not a crash", async () => {
    if (!(await ready())) return;
    const { runId } = await queued("probe.unknown");
    const outcome = await runOneWorkflow({ worker: "w1", runId, actions: createWorkflowActionPort({}) });
    expect(outcome.state).toBe("finished");
    expect((await getWorkflowRun(runId))?.state).toBe("failed");
  });
});
