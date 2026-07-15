import type { WorkflowJsonValue } from "../contracts";

const opaqueKey = (prefix: string, parts: readonly string[]): string =>
  `${prefix}:${parts.map((part) => `${part.length}:${part}`).join("")}`;

const assertSliceLimit = (limit: number): void => {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("batch slice limit must be a positive integer");
};

export type WorkflowBatchControlState = "active" | "paused" | "canceled";

export type WorkflowBatchTarget<TSnapshot extends WorkflowJsonValue> = {
  targetKey: string;
  snapshot: TSnapshot;
};

export type WorkflowBatchClaim<TSnapshot extends WorkflowJsonValue, TToken extends WorkflowJsonValue> = WorkflowBatchTarget<TSnapshot> & {
  token: TToken;
};

export const workflowBatchChildKey = (batchId: string, targetKey: string): string =>
  opaqueKey("workflow-batch-child", [batchId, targetKey]);

export type WorkflowBatchMaterializeProgress<TCursor extends WorkflowJsonValue> = {
  state: "more" | "complete" | "paused" | "canceled";
  cursor: TCursor | null;
  discovered: number;
  created: number;
};

export const materializeWorkflowBatchSlice = async <TCursor extends WorkflowJsonValue, TSnapshot extends WorkflowJsonValue>(options: {
  batchId: string;
  cursor: TCursor | null;
  limit: number;
  control(): Promise<WorkflowBatchControlState>;
  discover(input: {
    batchId: string;
    cursor: TCursor | null;
    limit: number;
  }): Promise<{ targets: readonly WorkflowBatchTarget<TSnapshot>[]; nextCursor: TCursor | null }>;
  materialize(input: {
    batchId: string;
    targets: ReadonlyArray<WorkflowBatchTarget<TSnapshot> & { childKey: string }>;
  }): Promise<{ accepted: number; created: number }>;
}): Promise<WorkflowBatchMaterializeProgress<TCursor>> => {
  assertSliceLimit(options.limit);
  const initialControl = await options.control();
  if (initialControl !== "active") {
    return { state: initialControl, cursor: options.cursor, discovered: 0, created: 0 };
  }

  const discovered = await options.discover({ batchId: options.batchId, cursor: options.cursor, limit: options.limit });
  if (discovered.targets.length > options.limit) throw new Error("batch discovery exceeded its slice limit");
  const targetKeys = new Set(discovered.targets.map((target) => target.targetKey));
  if (targetKeys.size !== discovered.targets.length) throw new Error("batch discovery returned duplicate target keys");

  const currentControl = await options.control();
  if (currentControl !== "active") {
    return { state: currentControl, cursor: options.cursor, discovered: discovered.targets.length, created: 0 };
  }

  const materialized = await options.materialize({
    batchId: options.batchId,
    targets: discovered.targets.map((target) => ({
      ...target,
      childKey: workflowBatchChildKey(options.batchId, target.targetKey),
    })),
  });
  if (materialized.accepted !== discovered.targets.length) {
    throw new Error("batch materialize must atomically accept every discovered target");
  }
  if (!Number.isSafeInteger(materialized.created) || materialized.created < 0 || materialized.created > materialized.accepted) {
    throw new Error("batch materialize returned an invalid created count");
  }
  return {
    state: discovered.nextCursor === null ? "complete" : "more",
    cursor: discovered.nextCursor,
    discovered: discovered.targets.length,
    created: materialized.created,
  };
};

export type WorkflowBatchTargetOutcome<TOutput extends WorkflowJsonValue, TError extends WorkflowJsonValue> =
  | { state: "completed"; output?: TOutput }
  | { state: "failed"; error: TError }
  | { state: "needs_attention"; error: TError };

export type WorkflowBatchProcessProgress = {
  state: "more" | "complete" | "paused" | "canceled";
  claimed: number;
  processed: number;
  completed: number;
  failed: number;
  needsAttention: number;
  released: number;
};

export const processWorkflowBatchSlice = async <
  TSnapshot extends WorkflowJsonValue,
  TToken extends WorkflowJsonValue,
  TOutput extends WorkflowJsonValue,
  TError extends WorkflowJsonValue,
>(options: {
  batchId: string;
  limit: number;
  control(): Promise<WorkflowBatchControlState>;
  claim(input: {
    batchId: string;
    limit: number;
  }): Promise<{ targets: readonly WorkflowBatchClaim<TSnapshot, TToken>[]; hasMore: boolean }>;
  process(input: {
    batchId: string;
    childKey: string;
    claim: WorkflowBatchClaim<TSnapshot, TToken>;
  }): Promise<WorkflowBatchTargetOutcome<TOutput, TError>>;
  onError(
    error: unknown,
    claim: WorkflowBatchClaim<TSnapshot, TToken>,
  ): Extract<WorkflowBatchTargetOutcome<TOutput, TError>, { state: "failed" | "needs_attention" }>;
  commit(input: {
    batchId: string;
    childKey: string;
    claim: WorkflowBatchClaim<TSnapshot, TToken>;
    outcome: WorkflowBatchTargetOutcome<TOutput, TError>;
  }): Promise<void>;
  release(claim: WorkflowBatchClaim<TSnapshot, TToken>): Promise<void>;
}): Promise<WorkflowBatchProcessProgress> => {
  assertSliceLimit(options.limit);
  const progress: WorkflowBatchProcessProgress = {
    state: "complete",
    claimed: 0,
    processed: 0,
    completed: 0,
    failed: 0,
    needsAttention: 0,
    released: 0,
  };
  const initialControl = await options.control();
  if (initialControl !== "active") return { ...progress, state: initialControl };

  const claimed = await options.claim({ batchId: options.batchId, limit: options.limit });
  progress.claimed = claimed.targets.length;
  if (claimed.targets.length > options.limit) throw new Error("batch claim exceeded its slice limit");
  const targetKeys = new Set(claimed.targets.map((target) => target.targetKey));
  if (targetKeys.size !== claimed.targets.length) throw new Error("batch claim returned duplicate target keys");

  let nextUnstarted = 0;
  const releaseRemaining = async (): Promise<void> => {
    const remaining = claimed.targets.slice(nextUnstarted);
    nextUnstarted = claimed.targets.length;
    const releases = await Promise.allSettled(remaining.map((claim) => options.release(claim)));
    progress.released += releases.filter((release) => release.status === "fulfilled").length;
    const failures = releases.flatMap((release) => (release.status === "rejected" ? [release.reason] : []));
    if (failures.length > 0) throw new AggregateError(failures, "failed to release unstarted workflow batch claims");
  };

  try {
    for (const [index, claim] of claimed.targets.entries()) {
      const control = await options.control();
      if (control !== "active") {
        nextUnstarted = index;
        await releaseRemaining();
        return { ...progress, state: control };
      }

      nextUnstarted = index + 1;
      const childKey = workflowBatchChildKey(options.batchId, claim.targetKey);
      let outcome: WorkflowBatchTargetOutcome<TOutput, TError>;
      try {
        outcome = await options.process({ batchId: options.batchId, childKey, claim });
      } catch (error) {
        outcome = options.onError(error, claim);
      }
      await options.commit({ batchId: options.batchId, childKey, claim, outcome });
      progress.processed += 1;
      if (outcome.state === "completed") progress.completed += 1;
      else if (outcome.state === "failed") progress.failed += 1;
      else progress.needsAttention += 1;
    }
  } catch (error) {
    try {
      await releaseRemaining();
    } catch (releaseError) {
      throw new AggregateError([error, releaseError], "workflow batch processing and claim cleanup failed");
    }
    throw error;
  }

  return { ...progress, state: claimed.hasMore ? "more" : "complete" };
};
