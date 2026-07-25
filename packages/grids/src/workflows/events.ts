/**
 * The occurrences that start a Grids workflow.
 *
 * Everything that starts work is an event — a schedule tick, a button press, a
 * row changing. Previously each of those had its own path into the run table
 * and its own durability story, and once a run existed only a bare `channel`
 * enum survived to say what caused it. Here the cause is a row the run points
 * at, so "why did this run" is answerable rather than inferred.
 */
import { workflowEvent } from "@valentinkolb/cloud/workflows";

/** Namespaced so two apps' event types cannot collide in the kernel. */
export const GRIDS_EVENT = {
  invoked: "grids.invoked",
  launcherPressed: "grids.launcherPressed",
  scheduleTick: "grids.scheduleTick",
  recordChanged: "grids.recordChanged",
} as const;

export const gridsWorkflowEvents = {
  invoked: workflowEvent({
    label: "Run requested",
    description: "Someone asked for this workflow directly — from the API, the CLI, or the workflow page.",
    data: { kind: "object", properties: {} },
  }),

  launcherPressed: workflowEvent({
    label: "Run option used",
    description: "A scanner, bulk action, or dashboard button started this workflow.",
    data: {
      kind: "object",
      properties: {
        launcherId: { kind: "string" },
        launcherKind: { kind: "string", enum: ["scanner", "bulk", "dashboard"] },
      },
    },
  }),

  scheduleTick: workflowEvent({
    label: "Schedule fired",
    description: "A scheduled slot came due.",
    data: {
      kind: "object",
      properties: {
        // The slot, not the moment the worker noticed it. A tick delivered late
        // still executes against the time it was meant for, so a replay after a
        // restart produces the same result as the first attempt would have.
        slot: { kind: "string" },
      },
    },
  }),

  recordChanged: workflowEvent({
    label: "Record changed",
    description: "A row was created, updated, or deleted in a table this workflow watches.",
    data: {
      kind: "object",
      properties: {
        tableId: { kind: "string" },
        recordId: { kind: "string" },
        event: { kind: "string", enum: ["created", "updated", "deleted"] },
      },
    },
  }),
} as const;
