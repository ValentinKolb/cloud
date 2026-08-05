/**
 * The occurrences that start a Grids workflow.
 *
 * Everything that starts work is an event — a schedule tick, a button press, a
 * row changing. Previously each of those had its own path into the run table
 * and its own durability story, and once a run existed only a bare `channel`
 * enum survived to say what caused it. Here the cause is a row the run points
 * at, so "why did this run" is answerable rather than inferred. These are the
 * runtime names emitted by Grids; authorable trigger contracts live in the
 * workflow module.
 */

/** Namespaced so two apps' event types cannot collide in the kernel. */
export const GRIDS_EVENT = {
  invoked: "grids.invoked",
  launcherPressed: "grids.launcherPressed",
  scheduleTick: "grids.scheduleTick",
  recordChanged: "grids.recordChanged",
} as const;
