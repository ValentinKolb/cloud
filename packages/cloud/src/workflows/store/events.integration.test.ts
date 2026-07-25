/**
 * Emission, matching and dispatch — the path every run now starts on.
 *
 * The cases worth a real database are the ones about *not* doing something
 * twice, and about a failure being visible instead of silent. A schedule that
 * stops firing with no error anywhere is the bug this whole slice exists to
 * make impossible.
 */
import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../../../../core/src/migrate/core/workflows";
import type { WorkflowBoundPlan } from "../contracts";
import { createWorkflow, publishWorkflowVersion } from "./definitions";
import { dispatchPendingWorkflowEvents, emitWorkflowEvent, listUndispatchedWorkflowEvents } from "./events";
import { claimWorkflowRun } from "./runs";

let readiness: Promise<boolean> | null = null;
const ready = (): Promise<boolean> => {
  readiness ??= (async () => {
    try {
      await migrate();
      const [row] = await sql<{ event: string | null }[]>`SELECT to_regclass('workflows.event')::text AS event`;
      return Boolean(row?.event);
    } catch {
      return false;
    }
  })();
  return readiness;
};

const hex = (seed: string) => new Bun.CryptoHasher("sha256").update(seed).digest("hex");
const PLAN = { steps: [] } as unknown as WorkflowBoundPlan;

/** A workflow listening for one event type, isolated by a unique scope. */
const listening = async (eventType: string, options: { activations?: number } = {}) => {
  const scopeId = `scope-${crypto.randomUUID()}`;
  const workflow = await createWorkflow({ appId: "probe", scopeId, key: "wf", name: "Probe", author: { kind: "system" } });
  const version = await publishWorkflowVersion({
    workflowId: workflow.id,
    source: "source",
    sourceHash: hex(scopeId),
    plan: PLAN,
    languageId: "probe",
    languageVersion: 1,
    manifestHash: hex("manifest"),
    author: { kind: "system" },
    activations: Array.from({ length: options.activations ?? 1 }, (_, index) => ({ key: `t${index}`, eventType })),
  });
  return { scopeId, workflowId: workflow.id, versionId: version.id };
};

describe("workflow events", () => {
  test("an event starts one run per activation listening for it", async () => {
    if (!(await ready())) return;
    const { scopeId } = await listening("probe.recordChanged", { activations: 2 });

    const emission = await emitWorkflowEvent(
      { appId: "probe", scopeId, type: "probe.recordChanged", data: { rowId: "r-1" } },
      { dispatch: "now" },
    );

    expect(emission.runIds).toHaveLength(2);
    expect(emission.duplicate).toBe(false);

    // The run carries the payload and points back at its cause, which is what
    // makes "why did this run" answerable at all.
    const claim = await claimWorkflowRun({ worker: "w1", runId: emission.runIds[0]! });
    expect(claim?.inputs).toEqual({ rowId: "r-1" });
  });

  test("an event nothing listens for is recorded rather than dropped", async () => {
    if (!(await ready())) return;
    const scopeId = `scope-${crypto.randomUUID()}`;
    const emission = await emitWorkflowEvent({ appId: "probe", scopeId, type: "probe.unheard" }, { dispatch: "now" });

    // Nothing ran, but the occurrence exists — an operator can see that the
    // event arrived and matched nothing, instead of inferring it from silence.
    expect(emission.runIds).toEqual([]);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM workflows.event WHERE id = ${emission.eventId}::uuid`;
    expect(row).toBeDefined();
  });

  test("the same dedupe key answers with the runs it already started", async () => {
    if (!(await ready())) return;
    const { scopeId } = await listening("probe.tick");
    const input = { appId: "probe", scopeId, type: "probe.tick", dedupeKey: "slot-2026-01-01T00:00" } as const;

    const first = await emitWorkflowEvent(input, { dispatch: "now" });
    const second = await emitWorkflowEvent(input, { dispatch: "now" });

    // A schedule that fires twice, or a webhook redelivered, must not double
    // the work — the second emission is answered with the first one's runs.
    expect(second.duplicate).toBe(true);
    expect(second.eventId).toBe(first.eventId);
    expect(second.runIds).toEqual(first.runIds);
  });

  test("a deferred event runs later, and dispatching twice adds nothing", async () => {
    if (!(await ready())) return;
    const { scopeId } = await listening("probe.deferred");

    const emission = await emitWorkflowEvent({ appId: "probe", scopeId, type: "probe.deferred" });
    expect(emission.runIds).toEqual([]);
    expect((await listUndispatchedWorkflowEvents({ appId: "probe" })).some((event) => event.id === emission.eventId)).toBe(true);

    expect((await dispatchPendingWorkflowEvents()).failed).toBe(0);
    const after = await sql<{ id: string }[]>`SELECT id FROM workflows.run WHERE event_id = ${emission.eventId}::uuid`;
    expect(after).toHaveLength(1);

    await dispatchPendingWorkflowEvents();
    const again = await sql<{ id: string }[]>`SELECT id FROM workflows.run WHERE event_id = ${emission.eventId}::uuid`;
    expect(again).toHaveLength(1);
  });

  test("a dispatch failure is recorded on the event, not swallowed", async () => {
    if (!(await ready())) return;
    const { scopeId } = await listening("probe.broken");
    const emission = await emitWorkflowEvent({ appId: "probe", scopeId, type: "probe.broken" });

    // The connection drops partway through dispatch. Schema constraints rule
    // out the data-shaped failures, so the realistic one is transport: what
    // matters is that the event survives it and says why.
    let tripped = false;
    const flaky = new Proxy(sql, {
      get(target, property, receiver) {
        if (property === "begin" && !tripped) {
          tripped = true;
          return async () => {
            throw new Error("connection reset during dispatch");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const result = await dispatchPendingWorkflowEvents(100, { db: flaky });
    expect(result.failed).toBe(1);

    const stuck = (await listUndispatchedWorkflowEvents({ appId: "probe" })).find((event) => event.id === emission.eventId);
    expect(stuck?.attempts).toBe(1);
    expect(stuck?.lastError).toBe("connection reset during dispatch");

    // Still dispatchable once the fault clears — a recorded failure is not a
    // dead end.
    expect((await dispatchPendingWorkflowEvents()).dispatched).toBeGreaterThan(0);
  });

  test("publishing a new version re-points activations with no window", async () => {
    if (!(await ready())) return;
    const { scopeId, workflowId, versionId } = await listening("probe.published");

    const second = await publishWorkflowVersion({
      workflowId,
      source: "source v2",
      sourceHash: hex(`${scopeId}-2`),
      plan: PLAN,
      languageId: "probe",
      languageVersion: 1,
      manifestHash: hex("manifest"),
      author: { kind: "system" },
      activations: [{ key: "t0", eventType: "probe.published" }],
    });
    expect(second.revision).toBe(2);

    // An event arriving now matches exactly once, on the new version — not
    // zero times, and not once per version.
    const emission = await emitWorkflowEvent({ appId: "probe", scopeId, type: "probe.published" }, { dispatch: "now" });
    expect(emission.runIds).toHaveLength(1);

    const [run] = await sql<{ workflow_version_id: string }[]>`
      SELECT workflow_version_id FROM workflows.run WHERE id = ${emission.runIds[0]!}::uuid
    `;
    expect(run?.workflow_version_id).toBe(second.id);
    expect(run?.workflow_version_id).not.toBe(versionId);
  });

  test("a trigger removed from the source stops firing", async () => {
    if (!(await ready())) return;
    const { scopeId, workflowId } = await listening("probe.removed");

    await publishWorkflowVersion({
      workflowId,
      source: "source without the trigger",
      sourceHash: hex(`${scopeId}-removed`),
      plan: PLAN,
      languageId: "probe",
      languageVersion: 1,
      manifestHash: hex("manifest"),
      author: { kind: "system" },
      activations: [],
    });

    const emission = await emitWorkflowEvent({ appId: "probe", scopeId, type: "probe.removed" }, { dispatch: "now" });
    expect(emission.runIds).toEqual([]);
  });

  test("an event only reaches workflows in its own scope", async () => {
    if (!(await ready())) return;
    const mine = await listening("probe.scoped");
    await listening("probe.scoped");

    const emission = await emitWorkflowEvent({ appId: "probe", scopeId: mine.scopeId, type: "probe.scoped" }, { dispatch: "now" });
    expect(emission.runIds).toHaveLength(1);
  });

  test("disabling a workflow stops it matching without deleting anything", async () => {
    if (!(await ready())) return;
    const { scopeId, workflowId } = await listening("probe.disabled");
    await sql`UPDATE workflows.activation SET enabled = false WHERE workflow_id = ${workflowId}::uuid`;

    const emission = await emitWorkflowEvent({ appId: "probe", scopeId, type: "probe.disabled" }, { dispatch: "now" });
    expect(emission.runIds).toEqual([]);
  });
});
