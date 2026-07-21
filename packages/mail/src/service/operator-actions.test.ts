import { describe, expect, test } from "bun:test";
import { operatorActionForCommand, operatorActionForFolder } from "./operator-actions";

const COMMAND_ID = "00000000-0000-4000-8000-000000000001";
const FOLDER_ID = "00000000-0000-4000-8000-000000000002";

describe("Mail operator action eligibility", () => {
  test("offers reconciliation but never blind retry for an ambiguous provider effect", () => {
    const command = {
      id: COMMAND_ID,
      kind: "move" as const,
      state: "ambiguous",
      provider_effect_started_at: new Date("2026-07-21T10:00:00.000Z"),
    };

    expect(
      operatorActionForCommand({ kind: "reconcile_effect", commandId: COMMAND_ID, idempotencyKey: "reconcile" }, command),
    ).toMatchObject({ eligible: true, safety: "reconcile_only" });
    expect(operatorActionForCommand({ kind: "retry_command", commandId: COMMAND_ID, idempotencyKey: "retry" }, command)).toMatchObject({
      eligible: false,
      reason: "Only provider-read maintenance work can be retried or cancelled here",
    });
  });

  test("allows an operator to restart reconciliation after automatic attempts are exhausted", () => {
    const command = {
      id: COMMAND_ID,
      kind: "move" as const,
      state: "needs_attention",
      provider_effect_started_at: new Date("2026-07-21T10:00:00.000Z"),
    };

    expect(
      operatorActionForCommand({ kind: "reconcile_effect", commandId: COMMAND_ID, idempotencyKey: "reconcile" }, command),
    ).toMatchObject({ eligible: true, safety: "reconcile_only" });
    expect(operatorActionForCommand({ kind: "retry_command", commandId: COMMAND_ID, idempotencyKey: "retry" }, command).eligible).toBe(
      false,
    );
  });

  test("limits retry and cancellation to the exact safe maintenance states", () => {
    const failed = { id: COMMAND_ID, kind: "hydrate_missing" as const, state: "failed", provider_effect_started_at: null };
    const queued = { ...failed, state: "queued" };

    expect(operatorActionForCommand({ kind: "retry_command", commandId: COMMAND_ID, idempotencyKey: "retry" }, failed)).toMatchObject({
      eligible: true,
      safety: "state_transition",
    });
    expect(operatorActionForCommand({ kind: "cancel_command", commandId: COMMAND_ID, idempotencyKey: "cancel" }, failed).eligible).toBe(
      true,
    );
    expect(operatorActionForCommand({ kind: "cancel_command", commandId: COMMAND_ID, idempotencyKey: "cancel" }, queued).eligible).toBe(
      true,
    );
    expect(operatorActionForCommand({ kind: "retry_command", commandId: COMMAND_ID, idempotencyKey: "retry" }, queued).eligible).toBe(
      false,
    );
  });

  test("uses the same folder eligibility for sync and rebuild presentation", () => {
    const active = { discovery_state: "active", selected_for_sync: true };
    const excluded = { discovery_state: "active", selected_for_sync: false };
    const missing = { discovery_state: "missing", selected_for_sync: true };

    expect(operatorActionForFolder({ kind: "sync_folder", folderId: FOLDER_ID, idempotencyKey: "sync" }, active).eligible).toBe(true);
    expect(operatorActionForFolder({ kind: "sync_folder", folderId: FOLDER_ID, idempotencyKey: "sync" }, excluded).eligible).toBe(false);
    expect(operatorActionForFolder({ kind: "rebuild_folder", folderId: FOLDER_ID, idempotencyKey: "rebuild" }, excluded).eligible).toBe(
      true,
    );
    expect(operatorActionForFolder({ kind: "rebuild_folder", folderId: FOLDER_ID, idempotencyKey: "rebuild" }, missing).eligible).toBe(
      false,
    );
  });

  test("disables equivalent actions already in flight", () => {
    const action = operatorActionForFolder(
      { kind: "rebuild_folder", folderId: FOLDER_ID, idempotencyKey: "rebuild" },
      { discovery_state: "active", selected_for_sync: true },
      true,
    );

    expect(action).toMatchObject({ eligible: false, reason: "An equivalent operator action is already pending" });
  });
});
