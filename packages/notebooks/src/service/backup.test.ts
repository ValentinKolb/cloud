import { describe, expect, test } from "bun:test";
import {
  buildNotebookBackupPaths,
  createNotebookBackupManifest,
  describeSnapshotError,
  type NotebookBackupConfig,
  type NotebookBackupObject,
  validateSnapshotEndpoint,
} from "./backup";
import type { NotebookExport } from "./export";

const config: NotebookBackupConfig = {
  enabled: true,
  endpoint: "https://s3.example.org",
  region: "eu-central-1",
  bucket: "cloud-backups",
  prefix: "notebooks",
  accessKeyId: "key",
  secretAccessKey: "secret",
  missing: [],
  configured: true,
};

const exported: NotebookExport = {
  filename: "daily-journal-2026-05-28.zip",
  notebook: {
    id: "11111111-1111-4111-8111-111111111111",
    shortId: "nb1234",
    name: "Daily Journal",
  },
  files: [],
  zip: new Uint8Array([1, 2, 3, 4]),
};

describe("notebook S3 backup", () => {
  test("builds deterministic latest, snapshot, and manifest object keys", () => {
    const paths = buildNotebookBackupPaths(config, {
      notebookShortId: "nb1234",
      exportedAt: new Date("2026-05-28T14:30:05.123Z"),
    });

    expect(paths).toEqual({
      latestZip: "notebooks/nb1234/latest.zip",
      snapshotZip: "notebooks/nb1234/snapshots/2026-05-28T14-30-05-123Z.zip",
      manifest: "notebooks/nb1234/latest-manifest.json",
    });
  });

  test("creates a manifest from the portable export metadata", () => {
    const paths = buildNotebookBackupPaths(config, {
      notebookShortId: exported.notebook.shortId,
      exportedAt: new Date("2026-05-28T14:30:05.123Z"),
    });

    const manifest = createNotebookBackupManifest({
      exported,
      exportedAt: new Date("2026-05-28T14:30:05.123Z"),
      paths,
    });

    expect(manifest).toMatchObject({
      format: "stuve.notebook.backup",
      version: 1,
      exportedAt: "2026-05-28T14:30:05.123Z",
      notebook: exported.notebook,
      filename: exported.filename,
      zipBytes: 4,
      paths,
    });
    expect(manifest.sha256).toHaveLength(64);
  });

  test("backup objects stay simple enough for uploader tests", () => {
    const object: NotebookBackupObject = {
      path: "notebooks/nb1234/latest.zip",
      contentType: "application/zip",
      content: exported.zip,
    };

    expect(object.content).toBe(exported.zip);
  });

  test("normalizes empty provider errors into actionable text", () => {
    expect(describeSnapshotError(new Error(""))).toBe("Provider returned no error details.");
    expect(describeSnapshotError(Object.assign(new Error(""), { name: "S3Error" }), "Check settings.")).toBe("Check settings.");
    expect(describeSnapshotError({ code: "AccessDenied" })).toBe('{"code":"AccessDenied"}');
  });

  test("summarizes HTML provider errors instead of returning whole pages", () => {
    const error = Object.assign(new Error("<html><head><title>403 - Forbidden</title></head><body>Status Code 403</body></html>"), {
      name: "S3Error",
    });

    expect(describeSnapshotError(error)).toBe("HTTP 403 403 - Forbidden (S3Error)");
  });

  test("rejects Hetzner endpoints without location subdomain", () => {
    const invalid = validateSnapshotEndpoint("https://your-objectstorage.com", "nbg1");
    const valid = validateSnapshotEndpoint("https://nbg1.your-objectstorage.com", "nbg1");

    expect(invalid.ok).toBe(false);
    expect(valid.ok).toBe(true);
    if (!invalid.ok) expect(invalid.error.message).toContain("https://nbg1.your-objectstorage.com");
  });
});
