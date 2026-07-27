import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const importPattern = /(?:from\s+|import\s*\()\s*["'](@(?:valentinkolb|k2b)\/[^"']+)["']/g;

export const packageSpecifiers = (source: string): Set<string> => new Set([...source.matchAll(importPattern)].map((match) => match[1]));

export const missingExampleImports = (documented: Iterable<string>, examples: Iterable<string>): string[] => {
  const covered = new Set(examples);
  return [...new Set(documented)]
    .filter((specifier) => !specifier.includes("/src/"))
    .filter((specifier) => !covered.has(specifier))
    .sort();
};

const listFiles = async (directory: string, extensions: Set<string>): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path, extensions)));
      continue;
    }

    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (entry.isFile() && extensions.has(extension)) files.push(path);
  }

  return files.sort();
};

if (import.meta.main) {
  const docsRoot = resolve(import.meta.dir, "../docs/en");
  const examplesRoot = resolve(import.meta.dir, "../../examples/cloud-docs");
  const docs = await listFiles(docsRoot, new Set([".md"]));
  const examples = await listFiles(examplesRoot, new Set([".ts", ".tsx"]));

  const documented = new Set<string>();
  for (const path of docs) {
    for (const specifier of packageSpecifiers(await Bun.file(path).text())) {
      documented.add(specifier);
    }
  }

  const covered = new Set<string>();
  for (const path of examples) {
    for (const specifier of packageSpecifiers(await Bun.file(path).text())) {
      covered.add(specifier);
    }
  }

  const missing = missingExampleImports(documented, covered);
  if (missing.length) {
    throw new Error(`Documented package imports without a compile fixture:\n${missing.map((specifier) => `- ${specifier}`).join("\n")}`);
  }

  console.log(
    `Documentation example coverage is current (${documented.size} documented package imports, ${examples.length} fixture files).`,
  );
}
