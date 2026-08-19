import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { assertSafeArchivePath, EvidenceTarWriter, safeArchiveSegment, tarHeader } from "./evidence-archive";
import { projectEvidenceValue } from "./evidence-exports";

const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

const readTar = (bytes: Uint8Array): Array<{ path: string; content: Uint8Array }> => {
  const decoder = new TextDecoder();
  const entries: Array<{ path: string; content: Uint8Array }> = [];
  let offset = 0;
  while (offset + 512 <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const path = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, "");
    const size = Number.parseInt(decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, "").trim(), 8);
    offset += 512;
    entries.push({ path, content: bytes.slice(offset, offset + size) });
    offset += size + ((512 - (size % 512)) % 512);
  }
  return entries;
};

describe("evidence TAR packages", () => {
  test("writes deterministic safe entries with verifiable entry and package hashes", async () => {
    const chunks: Uint8Array[] = [];
    const writer = new EvidenceTarWriter(new Date("2026-08-19T10:00:00.000Z"), async (chunk) => {
      chunks.push(chunk);
    });
    const first = await writer.addJson("records/REC001.json", "records", { id: "REC001", value: "hello" });
    const artifact = new TextEncoder().encode("exact document bytes");
    const second = await writer.addBytes("documents/RUN001/document.pdf", "documents", "application/pdf", artifact);
    const result = await writer.finish();
    const archive = concat(chunks);
    const entries = readTar(archive);

    expect(entries.map((entry) => entry.path)).toEqual(["records/REC001.json", "documents/RUN001/document.pdf"]);
    expect(new TextDecoder().decode(entries[0]!.content)).toContain('"id": "REC001"');
    expect(entries[1]!.content).toEqual(artifact);
    expect(first.sha256).toBe(createHash("sha256").update(entries[0]!.content).digest("hex"));
    expect(second.sha256).toBe(createHash("sha256").update(artifact).digest("hex"));
    expect(result.sizeBytes).toBe(archive.byteLength);
    expect(result.sha256).toBe(createHash("sha256").update(archive).digest("hex"));
    expect(archive.byteLength % 512).toBe(0);
  });

  test("rejects traversal and normalizes user filenames into one safe segment", () => {
    expect(() => assertSafeArchivePath("../secret.txt")).toThrow("Unsafe evidence archive path");
    expect(() => tarHeader("/absolute.txt", 0, new Date())).toThrow("Unsafe evidence archive path");
    expect(safeArchiveSegment("../../Customer invoice #4.pdf")).toBe("Customer-invoice-4.pdf");
  });

  test("fails before writing beyond the configured entry and package budgets", async () => {
    const entryBound = new EvidenceTarWriter(new Date(0), async () => undefined, { maxEntries: 1, maxPackageBytes: 4096 });
    await entryBound.addBytes("one.txt", "records", "text/plain", new Uint8Array());
    expect(entryBound.addBytes("two.txt", "records", "text/plain", new Uint8Array())).rejects.toThrow("1 entry limit");

    const byteBound = new EvidenceTarWriter(new Date(0), async () => undefined, { maxEntries: 2, maxPackageBytes: 1024 });
    await byteBound.addBytes("one.txt", "records", "text/plain", new Uint8Array());
    expect(byteBound.finish()).rejects.toThrow("1024 byte limit");
  });

  test("projects known Grids UUIDs to Public IDs and pseudonymizes every other UUID", () => {
    const recordId = "11111111-1111-4111-8111-111111111111";
    const actorId = "22222222-2222-4222-8222-222222222222";
    const projected = projectEvidenceValue(
      { id: recordId, actor: { type: "user", id: actorId }, [recordId]: [actorId] },
      new Map([[recordId, "REC001"]]),
    );
    const json = JSON.stringify(projected);
    expect(projected).toEqual({
      id: "REC001",
      actor: { type: "user", id: expect.stringMatching(/^private:/) },
      REC001: [expect.stringMatching(/^private:/)],
    });
    expect(json).not.toContain(recordId);
    expect(json).not.toContain(actorId);
  });
});
