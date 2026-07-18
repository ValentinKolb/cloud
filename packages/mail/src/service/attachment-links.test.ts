import { describe, expect, test } from "bun:test";
import {
  type AttachmentLinkSnapshot,
  createAttachmentLink,
  decideAttachmentLinkDownload,
  hashAttachmentLinkToken,
  MAX_ATTACHMENT_LINK_FILE_BYTES,
} from "./attachment-links";

const NOW = new Date("2026-07-17T10:00:00.000Z");

const createLink = async (overrides: Partial<Parameters<typeof createAttachmentLink>[0]> = {}) => {
  const result = await createAttachmentLink({ fileSizeBytes: 1024, now: NOW, ...overrides });
  if (!result.ok) throw new Error(`Expected link creation to succeed, got ${result.code}`);
  return result;
};

describe("mail public attachment links", () => {
  test("returns an opaque token once and keeps only its hash in persistent state", async () => {
    const first = await createLink();
    const second = await createLink();

    expect(first.publicToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.publicToken).not.toBe(second.publicToken);
    expect(first.persistent.tokenHash).toBe(hashAttachmentLinkToken(first.publicToken));
    expect(first.persistent.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.persistent.tokenHash).not.toContain(first.publicToken);
    expect(first.persistent).not.toHaveProperty("publicToken");
  });

  test("enforces the 100 MiB per-file boundary without an aggregate quota", async () => {
    expect((await createAttachmentLink({ fileSizeBytes: MAX_ATTACHMENT_LINK_FILE_BYTES, now: NOW })).ok).toBe(true);
    expect(await createAttachmentLink({ fileSizeBytes: MAX_ATTACHMENT_LINK_FILE_BYTES + 1, now: NOW })).toEqual({
      ok: false,
      code: "invalid_file_size",
    });
  });

  test("bounds password work and persisted download counters", async () => {
    expect(await createAttachmentLink({ fileSizeBytes: 1, now: NOW, password: "x".repeat(257) })).toEqual({
      ok: false,
      code: "invalid_password",
    });
    expect(await createAttachmentLink({ fileSizeBytes: 1, now: NOW, maxDownloads: 1_000_001 })).toEqual({
      ok: false,
      code: "invalid_download_limit",
    });
  });

  test("uses Bun.password and returns the same public failure for missing and wrong passwords", async () => {
    const created = await createLink({ password: "correct horse battery staple" });
    expect(created.persistent.passwordHash).toStartWith("$argon2id$");

    const missing = await decideAttachmentLinkDownload({ link: created.persistent, publicToken: created.publicToken, now: NOW });
    const wrong = await decideAttachmentLinkDownload({
      link: created.persistent,
      publicToken: created.publicToken,
      password: "wrong",
      now: NOW,
    });
    const valid = await decideAttachmentLinkDownload({
      link: created.persistent,
      publicToken: created.publicToken,
      password: "correct horse battery staple",
      now: NOW,
    });

    expect(missing).toEqual({ ok: false, code: "unavailable" });
    expect(wrong).toEqual(missing);
    expect(valid).toEqual({ ok: true, nextDownloadCount: 1 });
  });

  test("rejects expired and revoked links with constant public semantics", async () => {
    const created = await createLink({ expiresAt: new Date(NOW.getTime() + 60_000) });
    const expired = await decideAttachmentLinkDownload({
      link: created.persistent,
      publicToken: created.publicToken,
      now: new Date(NOW.getTime() + 60_000),
    });
    const revoked = await decideAttachmentLinkDownload({
      link: { ...created.persistent, revokedAt: new Date(NOW.getTime() + 1) },
      publicToken: created.publicToken,
      now: NOW,
    });

    expect(expired).toEqual({ ok: false, code: "unavailable" });
    expect(revoked).toEqual(expired);
  });

  test("returns the next count below the limit and rejects an exhausted link", async () => {
    const created = await createLink({ maxDownloads: 2 });
    const available: AttachmentLinkSnapshot = { ...created.persistent, downloadCount: 1 };
    const exhausted: AttachmentLinkSnapshot = { ...created.persistent, downloadCount: 2 };

    expect(await decideAttachmentLinkDownload({ link: available, publicToken: created.publicToken, now: NOW })).toEqual({
      ok: true,
      nextDownloadCount: 2,
    });
    expect(await decideAttachmentLinkDownload({ link: exhausted, publicToken: created.publicToken, now: NOW })).toEqual({
      ok: false,
      code: "unavailable",
    });
  });

  test("fails closed for a wrong token and malformed persistent hashes", async () => {
    const created = await createLink({ password: "secret" });
    const wrongToken = await createLink();
    const tokenFailure = await decideAttachmentLinkDownload({
      link: created.persistent,
      publicToken: wrongToken.publicToken,
      password: "secret",
      now: NOW,
    });
    const passwordHashFailure = await decideAttachmentLinkDownload({
      link: { ...created.persistent, passwordHash: "not-a-password-hash" },
      publicToken: created.publicToken,
      password: "secret",
      now: NOW,
    });

    expect(tokenFailure).toEqual({ ok: false, code: "unavailable" });
    expect(passwordHashFailure).toEqual(tokenFailure);
  });
});
