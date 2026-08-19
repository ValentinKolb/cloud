import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvidenceExportManifest } from "./evidence-export-contracts";
import { verifyEvidencePackage } from "./evidence-package-verifier";
import { EVIDENCE_EXPORT_MAX_ENTRIES, EvidenceTarWriter, tarHeader } from "./service/evidence-archive";

const encoder = new TextEncoder();
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const packageFixture = async (options: { duplicate?: boolean; missing?: boolean } = {}) => {
  const chunks: Uint8Array[] = [];
  const writer = new EvidenceTarWriter(new Date("2026-08-19T10:00:00.000Z"), async (chunk) => {
    chunks.push(chunk);
  });
  await writer.addJson("records/rec001.json", "records", { id: "rec001", name: "Ada" });
  if (options.duplicate) await writer.addJson("records/rec001.json", "records", { id: "rec001", name: "Duplicate" });
  const manifest: EvidenceExportManifest = {
    schema: "cloud.grids.evidence-export",
    version: 1,
    generatedAt: "2026-08-19T10:00:00.000Z",
    request: { id: "exp001", requestedAt: "2026-08-19T09:59:00.000Z", requestedByDisplayName: "Ada" },
    consistency: { kind: "postgres-repeatable-read", cutAt: "2026-08-19T10:00:00.000Z" },
    scope: {
      baseId: "base01",
      tableId: "tbl001",
      from: null,
      to: null,
      sections: ["records", "revisions"],
    },
    coverage: {
      completeWithinAvailableCoverage: true,
      history: [{ tableId: "tbl001", available: false, startsAt: null, baselineComplete: false }],
      sources: [
        {
          section: "records",
          currentAt: "2026-08-19T10:00:00.000Z",
          from: null,
          to: null,
          note: "Current Records at the cut.",
        },
      ],
      note: "Tables without Durable History include current state and available audit only.",
    },
    counts: { records: 1 },
    limits: { maxRowsPerPagedSource: 10_000, maxEntries: 25_000, maxPackageBytes: 536_870_912, maxDurationMs: 300_000 },
    identity: "Grids resources use Public IDs.",
    entries: [
      ...(options.duplicate ? [writer.entries[0]!, writer.entries[1]!] : writer.entries),
      ...(options.missing
        ? [
            {
              path: "records/missing.json",
              category: "records",
              mediaType: "application/json",
              sizeBytes: 2,
              sha256: createHash("sha256").update("{}").digest("hex"),
            },
          ]
        : []),
    ],
  };
  const manifestBytes = encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  await writer.addBytes("manifest.json", "manifest", "application/json", manifestBytes);
  const result = await writer.finish();
  const bytes = Buffer.concat(chunks);
  const dir = await mkdtemp(join(tmpdir(), "grids-evidence-verify-"));
  dirs.push(dir);
  const path = join(dir, "package.tar");
  await writeFile(path, bytes);
  return { path, bytes, packageSha256: result.sha256, manifestSha256 };
};

describe("Grids evidence package verifier", () => {
  test("verifies a complete package and reports its honest coverage", async () => {
    const fixture = await packageFixture();
    const result = await verifyEvidencePackage(fixture.path, {
      packageSha256: fixture.packageSha256,
      manifestSha256: fixture.manifestSha256,
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.package.sha256).toBe(fixture.packageSha256);
    expect(result.manifest.sha256).toBe(fixture.manifestSha256);
    expect(result.scope).toMatchObject({ baseId: "base01", tableId: "tbl001" });
    expect(result.coverage?.history[0]).toMatchObject({ available: false, baselineComplete: false });
    expect(result.verifiedEntries).toBe(1);
  });

  test("fails package and entry hashes after evidence bytes are changed", async () => {
    const fixture = await packageFixture();
    const tampered = Buffer.from(fixture.bytes);
    const marker = tampered.indexOf(Buffer.from("Ada"));
    expect(marker).toBeGreaterThan(0);
    tampered[marker] = "E".charCodeAt(0);
    await writeFile(fixture.path, tampered);

    const result = await verifyEvidencePackage(fixture.path, { packageSha256: fixture.packageSha256 });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("package.hash_mismatch");
    expect(result.issues.map((issue) => issue.code)).toContain("entry.hash_mismatch");
  });

  test("rejects duplicate archive and manifest paths", async () => {
    const fixture = await packageFixture({ duplicate: true });
    const result = await verifyEvidencePackage(fixture.path);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("tar.duplicate_path");
    expect(result.issues.map((issue) => issue.code)).toContain("manifest.duplicate_path");
  });

  test("rejects unsafe archive paths and manifest entries that are not present", async () => {
    const fixture = await packageFixture({ missing: true });
    const unsafe = Buffer.from(fixture.bytes);
    unsafe.fill(0, 0, 100);
    unsafe.write("../record.json", 0, "utf8");
    unsafe.fill(0x20, 148, 156);
    const checksum = unsafe.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
    unsafe.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    await writeFile(fixture.path, unsafe);

    const result = await verifyEvidencePackage(fixture.path);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["tar.unsafe_path", "entry.missing", "entry.unexpected"]),
    );
  });

  test("rejects a manifest beyond the metadata budget without extracting it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grids-evidence-large-manifest-"));
    dirs.push(dir);
    const path = join(dir, "large-manifest.tar");
    const manifestSize = EVIDENCE_EXPORT_MAX_ENTRIES * 1024 + 1;
    const padding = (512 - (manifestSize % 512)) % 512;
    const handle = await open(path, "w");
    try {
      await handle.write(tarHeader("manifest.json", manifestSize, new Date(0)), 0, 512, 0);
      await handle.truncate(512 + manifestSize + padding + 1024);
    } finally {
      await handle.close();
    }

    const result = await verifyEvidencePackage(path);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("manifest.too_large");
  });

  test("rejects missing manifests and trailing bytes without extracting files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grids-evidence-invalid-"));
    dirs.push(dir);
    const path = join(dir, "invalid.tar");
    await writeFile(path, new Uint8Array(1536));

    const result = await verifyEvidencePackage(path);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["tar.trailing_data", "manifest.missing"]));
  });

  test("validates expected hash input before opening a package", async () => {
    await expect(verifyEvidencePackage("missing.tar", { packageSha256: "not-a-hash" })).rejects.toThrow(
      "Package SHA-256 must be a 64-character SHA-256 value",
    );
  });
});
