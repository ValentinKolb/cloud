import { describe, expect, test } from "bun:test";
import type { BindingCandidate, BindingSelectionInput } from "./execution";
import { selectBindingCandidate } from "./execution";

const candidate = (overrides: Partial<BindingCandidate> = {}): BindingCandidate => ({
  bindingId: overrides.bindingId ?? "binding-1",
  connectionId: overrides.connectionId ?? "connection-1",
  secretRevision: overrides.secretRevision ?? 1,
  folders: overrides.folders ?? { inbox: { path: "INBOX", rights: ["read"] } },
  identityVerified: overrides.identityVerified ?? false,
  savesSentAutomatically: overrides.savesSentAutomatically ?? null,
  lastErrorCode: overrides.lastErrorCode ?? null,
  lastUsedAt: overrides.lastUsedAt ?? null,
});

const input = (overrides: Partial<BindingSelectionInput> = {}): BindingSelectionInput => ({
  operation: "actorRead",
  senderPolicy: null,
  senderSentFolderId: null,
  folderRequirements: [{ folderId: "inbox", rights: ["read"] }],
  candidates: [candidate()],
  ...overrides,
});

describe("mail execution binding selection", () => {
  test("selects the mailbox binding when all required rights are current", () => {
    expect(selectBindingCandidate(input())?.bindingId).toBe("binding-1");
  });

  test("fails closed when the single binding lacks a required right", () => {
    expect(
      selectBindingCandidate(
        input({
          operation: "actorMutation",
          folderRequirements: [{ folderId: "inbox", rights: ["write_flags"] }],
        }),
      ),
    ).toBeNull();
  });

  test("fails closed if storage exposes multiple current bindings", () => {
    expect(selectBindingCandidate(input({ candidates: [candidate(), candidate({ bindingId: "binding-2" })] }))).toBeNull();
  });

  test("actor send requires a verified sender binding", () => {
    expect(
      selectBindingCandidate(
        input({
          operation: "actorSend",
          senderPolicy: { automation: "disabled" },
          senderSentFolderId: null,
          folderRequirements: [],
          candidates: [candidate({ identityVerified: false })],
        }),
      ),
    ).toBeNull();
  });

  test("actor send requires append rights when the provider does not save sent mail", () => {
    expect(
      selectBindingCandidate(
        input({
          operation: "actorSend",
          senderPolicy: { automation: "disabled" },
          senderSentFolderId: "sent",
          folderRequirements: [],
          candidates: [
            candidate({
              identityVerified: true,
              savesSentAutomatically: false,
              folders: { sent: { path: "Sent", rights: ["read"] } },
            }),
          ],
        }),
      ),
    ).toBeNull();
  });

  test("actor send accepts verified provider-side Sent handling", () => {
    expect(
      selectBindingCandidate(
        input({
          operation: "actorSend",
          senderPolicy: { automation: "disabled" },
          senderSentFolderId: null,
          folderRequirements: [],
          candidates: [candidate({ identityVerified: true, savesSentAutomatically: true })],
        }),
      )?.bindingId,
    ).toBe("binding-1");
  });

  test("automation is enabled only by the mailbox sender policy", () => {
    const current = candidate({ identityVerified: true });
    expect(
      selectBindingCandidate(
        input({ operation: "automation", senderPolicy: { automation: "disabled" }, folderRequirements: [], candidates: [current] }),
      ),
    ).toBeNull();
    expect(
      selectBindingCandidate(
        input({ operation: "automation", senderPolicy: { automation: "mailbox" }, folderRequirements: [], candidates: [current] }),
      )?.bindingId,
    ).toBe("binding-1");
  });
});
