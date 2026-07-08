import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Guard: AI tests run against the shared dev database and Redis. A test that
 * writes shared settings (coreSettings.set / settings.entries) wipes the
 * developer's configured model profiles — this has happened twice. Tests must
 * inject their configuration instead (e.g. the executor's validateTurn seam).
 */

const collectTestFiles = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTestFiles(path));
    else if (/\.test\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
};

describe("AI test settings guard", () => {
  test("no AI test writes shared settings", () => {
    const root = resolve(import.meta.dir);
    const offenders: string[] = [];

    for (const file of collectTestFiles(root)) {
      if (file.endsWith("settings-guard.test.ts")) continue;
      const source = readFileSync(file, "utf8");
      const writesViaApi = /coreSettings\s*\.\s*set\s*\(/.test(source);
      const writesViaSql = /(INSERT INTO|UPDATE|DELETE FROM)\s+settings\.entries/i.test(source);
      if (writesViaApi || writesViaSql) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
