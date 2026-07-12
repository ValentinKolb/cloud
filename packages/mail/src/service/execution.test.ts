import { describe, expect, test } from "bun:test";
import type { BindingCandidate, BindingSelectionInput } from "./execution";
import { selectBindingCandidate } from "./execution";

const candidate = (overrides: Partial<BindingCandidate> & Pick<BindingCandidate, "bindingId" | "owner">): BindingCandidate => ({
  bindingId: overrides.bindingId,
  connectionId: overrides.connectionId ?? `connection-${overrides.bindingId}`,
  secretRevision: overrides.secretRevision ?? 1,
  owner: overrides.owner,
  folders: overrides.folders ?? { folder: { path: "INBOX", rights: ["read"] } },
  identityVerified: overrides.identityVerified ?? false,
  savesSentAutomatically: overrides.savesSentAutomatically ?? null,
  lastErrorCode: overrides.lastErrorCode ?? null,
  lastUsedAt: overrides.lastUsedAt ?? null,
});

const input = (overrides: Partial<BindingSelectionInput>): BindingSelectionInput => ({
  connectionPolicy: "shared_connection",
  mailboxId: "mailbox-1",
  operation: "actorRead",
  actorOwner: { type: "user", id: "user-1" },
  senderPolicy: null,
  senderSentFolderId: null,
  folderRequirements: [{ folderId: "folder", rights: ["read"] }],
  candidates: [],
  ...overrides,
});

describe("mail execution binding selection", () => {
  test("shared mode never borrows an actor-owned connection", () => {
    const selected = selectBindingCandidate(
      input({
        candidates: [
          candidate({ bindingId: "actor", owner: { type: "user", id: "user-1" } }),
          candidate({ bindingId: "mailbox", owner: { type: "mailbox", id: "mailbox-1" } }),
        ],
      }),
    );
    expect(selected?.bindingId).toBe("mailbox");
  });

  test("personal mode uses only the acting principal binding", () => {
    const selected = selectBindingCandidate(
      input({
        connectionPolicy: "personal_provider_account",
        operation: "actorMutation",
        candidates: [
          candidate({
            bindingId: "alice",
            owner: { type: "user", id: "user-1" },
            folders: { folder: { path: "INBOX", rights: ["read", "write_flags"] } },
          }),
          candidate({
            bindingId: "bob",
            owner: { type: "user", id: "user-2" },
            folders: { folder: { path: "INBOX", rights: ["read", "write_flags"] } },
          }),
        ],
        folderRequirements: [{ folderId: "folder", rights: ["write_flags"] }],
      }),
    );
    expect(selected?.bindingId).toBe("alice");
  });

  test("does not union partial rights across bindings", () => {
    const selected = selectBindingCandidate(
      input({
        operation: "backgroundSync",
        candidates: [
          candidate({ bindingId: "read", owner: { type: "user", id: "user-1" }, folders: { folder: { path: "INBOX", rights: ["read"] } } }),
          candidate({
            bindingId: "write",
            owner: { type: "user", id: "user-2" },
            folders: { folder: { path: "INBOX", rights: ["write_flags"] } },
          }),
        ],
        folderRequirements: [{ folderId: "folder", rights: ["read", "write_flags"] }],
      }),
    );
    expect(selected).toBeNull();
  });

  test("background sync may fail over to any complete verified owner", () => {
    const selected = selectBindingCandidate(
      input({
        connectionPolicy: "personal_provider_account",
        operation: "backgroundSync",
        actorOwner: null,
        candidates: [candidate({ bindingId: "bob", owner: { type: "user", id: "user-2" } })],
      }),
    );
    expect(selected?.bindingId).toBe("bob");
  });

  test("background sync prefers a binding without a recorded transport error", () => {
    const selected = selectBindingCandidate(
      input({
        operation: "backgroundSync",
        actorOwner: null,
        candidates: [
          candidate({
            bindingId: "recent-but-failing",
            owner: { type: "mailbox", id: "mailbox-1" },
            lastErrorCode: "ETIMEDOUT",
            lastUsedAt: "2026-07-11T12:00:00.000Z",
          }),
          candidate({
            bindingId: "healthy-fallback",
            owner: { type: "mailbox", id: "mailbox-1" },
            lastUsedAt: "2026-07-10T12:00:00.000Z",
          }),
        ],
      }),
    );
    expect(selected?.bindingId).toBe("healthy-fallback");
  });

  test("actor sender policy requires that actor's independently verified identity binding", () => {
    const selected = selectBindingCandidate(
      input({
        connectionPolicy: "personal_provider_account",
        operation: "actorSend",
        senderPolicy: { interactive: "actor", automation: "disabled" },
        senderSentFolderId: null,
        candidates: [
          candidate({ bindingId: "alice-unverified", owner: { type: "user", id: "user-1" }, identityVerified: false }),
          candidate({ bindingId: "bob-verified", owner: { type: "user", id: "user-2" }, identityVerified: true }),
        ],
        folderRequirements: [],
      }),
    );
    expect(selected).toBeNull();
  });

  test("actor send requires append rights when the provider does not save sent mail", () => {
    const selected = selectBindingCandidate(
      input({
        operation: "actorSend",
        senderPolicy: { interactive: "mailbox", automation: "disabled" },
        senderSentFolderId: "sent",
        candidates: [
          candidate({
            bindingId: "mailbox",
            owner: { type: "mailbox", id: "mailbox-1" },
            identityVerified: true,
            savesSentAutomatically: false,
            folders: { sent: { path: "Sent", rights: ["read"] } },
          }),
        ],
        folderRequirements: [],
      }),
    );
    expect(selected).toBeNull();
  });

  test("actor send accepts verified auto-save bindings without a Sent mapping", () => {
    const selected = selectBindingCandidate(
      input({
        operation: "actorSend",
        senderPolicy: { interactive: "mailbox", automation: "disabled" },
        candidates: [
          candidate({
            bindingId: "mailbox",
            owner: { type: "mailbox", id: "mailbox-1" },
            identityVerified: true,
            savesSentAutomatically: true,
          }),
        ],
        folderRequirements: [],
      }),
    );
    expect(selected?.bindingId).toBe("mailbox");
  });

  test("automation disabled never falls back to a mailbox or pool binding", () => {
    const selected = selectBindingCandidate(
      input({
        operation: "automation",
        actorOwner: null,
        senderPolicy: { interactive: "mailbox", automation: "disabled" },
        candidates: [candidate({ bindingId: "mailbox", owner: { type: "mailbox", id: "mailbox-1" }, identityVerified: true })],
        folderRequirements: [],
      }),
    );
    expect(selected).toBeNull();
  });

  test("automation without a verified sender policy fails closed", () => {
    const selected = selectBindingCandidate(
      input({
        operation: "automation",
        actorOwner: null,
        senderPolicy: null,
        candidates: [candidate({ bindingId: "bob", owner: { type: "user", id: "user-2" }, identityVerified: false })],
        folderRequirements: [],
      }),
    );
    expect(selected).toBeNull();
  });
});
