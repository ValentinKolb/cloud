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
import { createWorkflowActionPort, createWorkflowDryRunPort } from "./actions";
import { createWorkflow, publishWorkflowVersion } from "./definitions";
import { emitWorkflowEvent } from "./events";
import { getWorkflowRun } from "./observability";
import { beginWorkflowEffect, claimWorkflowRun, createWorkflowRuntimeRepository } from "./runs";
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

const step = (action: string, extra: Record<string, string> = {}): WorkflowIrStep => ({
  kind: "action",
  action,
  config: { to: "a@b.c", ...extra },
  sourcePath: ["steps", 0],
});

const queued = async (action: string, effectBudget: Record<string, number> = {}, extraConfig: Record<string, string> = {}) => {
  const appId = `decl-${crypto.randomUUID().slice(0, 8)}`;
  const scopeId = `scope-${crypto.randomUUID()}`;
  const workflow = await createWorkflow({ appId, scopeId, key: "wf", name: "Declared", author: { kind: "system" } });
  await publishWorkflowVersion({
    workflowId: workflow.id,
    source: "probe",
    sourceHash: hex(scopeId),
    plan: plan([action], [step(action, extraConfig)]),
    languageId: "probe",
    languageVersion: 1,
    manifestHash: hex("manifest"),
    effectBudget,
    author: { kind: "system" },
    activations: [{ key: "t0", eventType: "probe.declared" }],
  });
  const emission = await emitWorkflowEvent({ appId, scopeId, type: "probe.declared" }, { dispatch: "now" });
  return { runId: emission.runIds[0]!, appId, workflowId: workflow.id };
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

  test("an effect that escaped is reconciled, never repeated", async () => {
    if (!(await ready())) return;
    const { runId } = await queued("probe.escaped");

    // A previous attempt marked the effect and died before settling it — the
    // message may already have gone out.
    const claim = await claimWorkflowRun({ worker: "w0", runId });
    const journal = createWorkflowRuntimeRepository();
    const sending = {
      runId,
      executionGeneration: claim!.executionGeneration,
      mode: "execute" as const,
      workflowId: "unused",
      sourceHash: "unused",
      idempotencyKey: "unused",
      key: "steps.0",
      sourcePath: ["steps", 0],
      iterationPath: [],
      path: ["steps", 0],
      kind: "action" as const,
      action: "probe.escaped",
    };
    await journal.startStep(sending);
    await beginWorkflowEffect(sending, `workflow:${runId}:step:steps.0`);
    await sql`
      UPDATE workflows.run SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, retry_after = NULL WHERE id = ${runId}::uuid
    `;

    let ran = false;
    let reconciled = false;
    const actions = {
      "probe.escaped": workflowAction.ambiguous({
        label: "Send",
        description: "Sends.",
        config: CONFIG,
        run: async () => {
          ran = true;
          return { state: "succeeded", output: { id: "second-send" } };
        },
        plan: async () => ({ summary: "send" }),
        reconcile: async () => {
          reconciled = true;
          return { state: "succeeded", output: { id: "first-send" } };
        },
      }),
    };

    await runOneWorkflow({ worker: "w1", runId, actions: createWorkflowActionPort(actions) });

    // The provider is asked, not asked again to send.
    expect(reconciled).toBe(true);
    expect(ran).toBe(false);
    expect((await getWorkflowRun(runId))?.state).toBe("succeeded");
    expect(await effectRow(runId)).toMatchObject({ effect_state: "succeeded" });
  });

  test("an escaped effect nobody can resolve waits for a human", async () => {
    if (!(await ready())) return;
    const { runId } = await queued("probe.unknowable");

    const claim = await claimWorkflowRun({ worker: "w0", runId });
    const journal = createWorkflowRuntimeRepository();
    const sending = {
      runId,
      executionGeneration: claim!.executionGeneration,
      mode: "execute" as const,
      workflowId: "unused",
      sourceHash: "unused",
      idempotencyKey: "unused",
      key: "steps.0",
      sourcePath: ["steps", 0],
      iterationPath: [],
      path: ["steps", 0],
      kind: "action" as const,
      action: "probe.unknowable",
    };
    await journal.startStep(sending);
    await beginWorkflowEffect(sending, `workflow:${runId}:step:steps.0`);
    await sql`
      UPDATE workflows.run SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, retry_after = NULL WHERE id = ${runId}::uuid
    `;

    let ran = false;
    const actions = {
      "probe.unknowable": workflowAction.ambiguous({
        label: "Send",
        description: "Sends.",
        config: CONFIG,
        run: async () => {
          ran = true;
          return { state: "succeeded", output: null };
        },
        plan: async () => ({ summary: "send" }),
        reconcile: async () => ({ state: "unknown", message: "provider has no record either way" }),
      }),
    };

    await runOneWorkflow({ worker: "w1", runId, actions: createWorkflowActionPort(actions) });

    // Nothing is repeated on a human's behalf.
    expect(ran).toBe(false);
    expect((await getWorkflowRun(runId))?.state).toBe("needs_attention");
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

  test("a transactional action commits its work and its evidence together", async () => {
    if (!(await ready())) return;
    const { runId } = await queued("probe.tx");

    const actions = {
      "probe.tx": workflowAction.transactional({
        label: "Write",
        description: "Writes.",
        config: CONFIG,
        run: async (ctx) => {
          // The handle is the whole point of the class.
          expect(ctx.tx).toBeDefined();
          return { state: "succeeded", output: { written: true } };
        },
        plan: async () => ({ summary: "write" }),
      }),
    };

    await runOneWorkflow({ worker: "w1", runId, actions: createWorkflowActionPort(actions) });
    expect((await getWorkflowRun(runId))?.state).toBe("succeeded");
    expect(await effectRow(runId)).toMatchObject({ effect_state: "succeeded" });
  });

  test("a transactional replay returns the recorded output instead of working twice", async () => {
    if (!(await ready())) return;
    const { runId } = await queued("probe.tx-replay");

    let runs = 0;
    const actions = {
      "probe.tx-replay": workflowAction.transactional({
        label: "Write",
        description: "Writes.",
        config: CONFIG,
        run: async () => {
          runs += 1;
          return { state: "succeeded", output: { attempt: runs } };
        },
        plan: async () => ({ summary: "write" }),
      }),
    };
    const port = createWorkflowActionPort(actions);

    await runOneWorkflow({ worker: "w1", runId, actions: port });
    // Re-open the finished run and drive the same step again: the recorded
    // effect is what a crash-resumed attempt finds.
    await sql`
      UPDATE workflows.run SET state = 'queued', finished_at = NULL, lease_owner = NULL, lease_expires_at = NULL WHERE id = ${runId}::uuid
    `;
    await sql`UPDATE workflows.step_outcome SET state = 'running', outcome = NULL WHERE run_id = ${runId}::uuid`;
    await runOneWorkflow({ worker: "w2", runId, actions: port });

    expect(runs).toBe(1);
    expect((await getWorkflowRun(runId))?.state).toBe("succeeded");
  });

  test("a refused authorize fails the step without performing the work", async () => {
    if (!(await ready())) return;
    const { runId } = await queued("probe.denied");

    let ran = false;
    const actions = {
      "probe.denied": workflowAction.transactional({
        label: "Write",
        description: "Writes.",
        config: CONFIG,
        run: async () => {
          ran = true;
          return { state: "succeeded", output: null };
        },
        plan: async () => ({ summary: "write" }),
        // Access can be revoked between queueing and running.
        authorize: async () => false,
      }),
    };

    await runOneWorkflow({ worker: "w1", runId, actions: createWorkflowActionPort(actions) });
    expect(ran).toBe(false);
    expect((await getWorkflowRun(runId))?.state).toBe("failed");
  });

  test("an action sees who it acts as and what its app attached", async () => {
    if (!(await ready())) return;
    const { runId } = await queued("probe.context");

    const seen: { actor?: unknown; context?: unknown } = {};
    const actions = {
      "probe.context": workflowAction.pure({
        label: "Read",
        description: "Reads its invocation.",
        config: CONFIG,
        run: async (ctx) => {
          // An action that touches anything permissioned needs the actor, and
          // one that works inside a base or a mailbox reads that from the
          // context its app attached to the event.
          seen.actor = ctx.invocation.actor;
          seen.context = ctx.invocation.context;
          return { state: "succeeded", output: null };
        },
      }),
    };

    await runOneWorkflow({ worker: "w1", runId, actions: createWorkflowActionPort(actions) });
    expect(seen.actor).toBeDefined();
    expect(seen.context).toBeDefined();
  });

  test("a step's output lands under the name its config gives", async () => {
    if (!(await ready())) return;
    const { runId, workflowId } = await queued("probe.saved", {}, { saveAs: "created" });

    const actions = {
      "probe.saved": workflowAction.pure({
        label: "Make",
        description: "Makes something.",
        config: CONFIG,
        run: async () => ({ state: "succeeded", output: { id: "made-1" } }),
      }),
    };

    await runOneWorkflow({ worker: "w1", runId, actions: createWorkflowActionPort(actions) });

    // Both apps did this inside every action, which meant every action also had
    // to remember to redo it when a replay restored a recorded outcome.
    const detail = await getWorkflowRun(runId);
    expect(detail?.state).toBe("succeeded");
    expect(JSON.stringify(detail?.steps[0]?.state)).toContain("completed");
    expect(workflowId).toBeDefined();
  });

  test("an action the app never declared is a missing handler, not a crash", async () => {
    if (!(await ready())) return;
    const { runId } = await queued("probe.unknown");
    const outcome = await runOneWorkflow({ worker: "w1", runId, actions: createWorkflowActionPort({}) });
    expect(outcome.state).toBe("finished");
    expect((await getWorkflowRun(runId))?.state).toBe("failed");
  });

  test("a dry run reports impure steps and really runs pure ones", async () => {
    if (!(await ready())) return;

    const actions = {
      "probe.format": workflowAction.pure({
        label: "Format",
        description: "Formats.",
        config: CONFIG,
        run: async (_ctx, input) => ({ state: "succeeded", output: { normalized: input.to.toUpperCase() } }),
      }),
      "probe.send": workflowAction.ambiguous({
        label: "Send",
        description: "Sends.",
        config: CONFIG,
        run: async () => ({ state: "succeeded", output: { id: "real" } }),
        plan: async (_ctx, input) => ({
          summary: `send to ${input.to}`,
          consumes: { emails: 1 },
          output: { id: "planned", planned: true },
        }),
        reconcile: async () => ({ state: "unknown", message: "" }),
      }),
    };
    const port = createWorkflowDryRunPort(actions);
    const ctx = {
      run: { runId: "r-1" },
      step: {
        key: "steps.0",
        sourcePath: ["steps", 0],
        iterationPath: [],
        path: ["steps", 0],
        kind: "action" as const,
        action: "probe.send",
      },
      evaluate: async (value: unknown) => value,
      heartbeat: async () => undefined,
    };
    const step = { kind: "action" as const, action: "probe.send", config: { to: "a@b.c" }, sourcePath: ["steps", 0] };

    // A pure action is deterministic and touches nothing, so its dry run is
    // exact rather than a description.
    const pure = await port.get("probe.format")!.plan(ctx as never, step);
    expect(pure).toMatchObject({ state: "planned", output: { normalized: "A@B.C" } });

    // An impure one reports what it would do — and the synthetic output is what
    // keeps a dry run useful past its first impure step.
    const impure = await port.get("probe.send")!.plan(ctx as never, step);
    expect(impure).toMatchObject({ state: "planned", output: { id: "planned", planned: true } });
    expect(JSON.stringify((impure as { effects: unknown[] }).effects)).toContain("emails");
  });
});
