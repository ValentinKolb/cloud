import { expect, test } from "bun:test";
import type { WorkflowStepState } from "./contracts";

type PersistedStepState =
  | "running"
  | "completed"
  | "waiting"
  | "failed"
  | "needs_attention"
  | "terminal"
  | "planned"
  | "unsupported"
  | "indeterminate"
  | "canceled";

type ExactStepStateContract = [WorkflowStepState, PersistedStepState] extends [PersistedStepState, WorkflowStepState] ? true : false;

test("the exported step-state contract matches persisted kernel states", () => {
  const exact: ExactStepStateContract = true;
  expect(exact).toBe(true);
});
