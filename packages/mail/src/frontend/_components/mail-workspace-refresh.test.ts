import { describe, expect, test } from "bun:test";
import { captureMailWorkspaceRefreshError, requireMailWorkspaceRefresh } from "./mail-workspace-refresh";

describe("Mail workspace refresh outcomes", () => {
  test("accepts applied and superseded refreshes but rejects a failed refresh", async () => {
    await expect(requireMailWorkspaceRefresh(async () => "applied", "refresh failed")).resolves.toBeUndefined();
    await expect(requireMailWorkspaceRefresh(async () => "stale", "refresh failed")).resolves.toBeUndefined();
    await expect(requireMailWorkspaceRefresh(async () => "failed", "refresh failed")).rejects.toThrow("refresh failed");
  });

  test("keeps a completed write separate from its refresh error", async () => {
    await expect(captureMailWorkspaceRefreshError(async () => undefined)).resolves.toBeNull();
    await expect(
      captureMailWorkspaceRefreshError(async () => {
        throw new Error("view unavailable");
      }),
    ).resolves.toEqual(new Error("view unavailable"));
  });
});
