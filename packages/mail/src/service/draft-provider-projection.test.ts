import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import {
  assertRemoteDraftBodyWithinLimit,
  draftExportJobKey,
  remoteAppendEffectPossible,
  remoteDraftNeedsImport,
  removeMimeTransportLineEnding,
  resolveRemoteDraftBaseRevision,
} from "./draft-provider-projection";

describe("generic IMAP draft reconciliation", () => {
  test("uses immutable snapshot ids for export job idempotency", () => {
    expect(draftExportJobKey("revision-one")).toBe("snapshot:revision-one");
    expect(draftExportJobKey("revision-two")).not.toBe(draftExportJobKey("revision-one"));
  });

  test("retries APPEND only when the connector proves no provider effect was possible", () => {
    expect(remoteAppendEffectPossible(Object.assign(new Error("connect failed"), { effectPossible: false }))).toBe(false);
    expect(remoteAppendEffectPossible(Object.assign(new Error("socket closed"), { effectPossible: true }))).toBe(true);
    expect(remoteAppendEffectPossible(new Error("unknown connector failure"))).toBe(true);
  });

  test("removes only the MIME transport line ending from imported bodies", () => {
    expect(removeMimeTransportLineEnding("body\r\n")).toBe("body");
    expect(removeMimeTransportLineEnding("body\n\n")).toBe("body\n");
    expect(removeMimeTransportLineEnding("body")).toBe("body");
  });

  test("uses MODSEQ changes when the provider exposes CONDSTORE state", () => {
    expect(remoteDraftNeedsImport({ previousModseq: "41", currentModseq: "42", fullReconciliation: false })).toBe(true);
    expect(remoteDraftNeedsImport({ previousModseq: "42", currentModseq: "42", fullReconciliation: true })).toBe(false);
  });

  test("performs a content comparison during full reconciliation without MODSEQ", () => {
    expect(remoteDraftNeedsImport({ previousModseq: null, currentModseq: null, fullReconciliation: false })).toBe(false);
    expect(remoteDraftNeedsImport({ previousModseq: null, currentModseq: null, fullReconciliation: true })).toBe(true);
  });

  test("observes a provider adding or removing MODSEQ support", () => {
    expect(remoteDraftNeedsImport({ previousModseq: null, currentModseq: "1", fullReconciliation: false })).toBe(true);
    expect(remoteDraftNeedsImport({ previousModseq: "1", currentModseq: null, fullReconciliation: false })).toBe(true);
  });

  test("uses the canonical observation revision over stale provider headers", () => {
    expect(resolveRemoteDraftBaseRevision({ snapshotRevision: 8, headerRevision: 7 })).toBe(8);
    expect(resolveRemoteDraftBaseRevision({ snapshotRevision: null, headerRevision: 7 })).toBe(7);
    expect(resolveRemoteDraftBaseRevision({ snapshotRevision: null, headerRevision: null })).toBe(1);
  });

  test("rejects oversized decoded body parts before MailParser buffers them", async () => {
    const headers = Buffer.from("From: sender@example.com\r\nTo: recipient@example.com\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n");
    await expect(assertRemoteDraftBodyWithinLimit(Readable.from([headers, Buffer.alloc(2 * 1024 * 1024, 0x61)]))).resolves.toBeUndefined();
    await expect(assertRemoteDraftBodyWithinLimit(Readable.from([headers, Buffer.alloc(2 * 1024 * 1024 + 1, 0x61)]))).rejects.toMatchObject(
      { code: "REMOTE_DRAFT_BODY_TOO_LARGE" },
    );
  });
});
