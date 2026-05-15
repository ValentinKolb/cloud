import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import type { ScriptTypeFile } from "../src/frontend/lib/editor/script-intelligence-protocol";

const TS_LIB_ROOT = resolve("node_modules/typescript/lib");
const STDLIB_SRC_ROOT = resolve("node_modules/@valentinkolb/stdlib/src");
const VIRTUAL_STDLIB_ROOT = "/node_modules/@valentinkolb/stdlib/src";

const TS_LIB_ENTRY = "lib.es2022.full.d.ts";

const posix = (path: string): string => path.split(sep).join("/");

const readText = (path: string) => readFile(path, "utf8");

const referencedLibs = (source: string): string[] => {
  const refs: string[] = [];
  const regex = /<reference\s+lib=["']([^"']+)["']\s*\/>/g;
  for (const match of source.matchAll(regex)) refs.push(`lib.${match[1]}.d.ts`);
  return refs;
};

const collectTypeScriptLibs = async (): Promise<ScriptTypeFile[]> => {
  const seen = new Set<string>();
  const files: ScriptTypeFile[] = [];
  const queue = [TS_LIB_ENTRY];

  while (queue.length > 0) {
    const fileName = queue.shift()!;
    if (seen.has(fileName)) continue;
    seen.add(fileName);

    const text = await readText(resolve(TS_LIB_ROOT, fileName));
    files.push({ path: `/typescript/lib/${fileName}`, text });
    queue.push(...referencedLibs(text));
  }

  return files;
};

const importSpecifiers = (source: string): string[] => {
  const specs: string[] = [];
  const regex = /\b(?:import|export)\b(?:[^"'`]*?\bfrom\s*)?["']([^"']+)["']/g;
  for (const match of source.matchAll(regex)) {
    const specifier = match[1];
    if (specifier?.startsWith(".")) specs.push(specifier);
  }
  return specs;
};

const resolveStdlibImport = (fromFile: string, specifier: string): string | null => {
  const base = normalize(resolve(dirname(fromFile), specifier));
  const candidates = [base, `${base}.ts`, join(base, "index.ts")];
  return candidates.find((candidate) => (extname(candidate) === ".ts" || candidate.endsWith(".ts")) && existsSync(candidate)) ?? null;
};

const collectStdlibSources = async (): Promise<ScriptTypeFile[]> => {
  const roots = [resolve(STDLIB_SRC_ROOT, "index.ts"), resolve(STDLIB_SRC_ROOT, "qr.ts"), resolve(STDLIB_SRC_ROOT, "browser/index.ts")];
  const queue = [...roots];
  const seen = new Set<string>();
  const files: ScriptTypeFile[] = [];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const text = await readText(file);
    const rel = posix(relative(STDLIB_SRC_ROOT, file));
    files.push({ path: `${VIRTUAL_STDLIB_ROOT}/${rel}`, text });

    for (const specifier of importSpecifiers(text)) {
      const resolved = resolveStdlibImport(file, specifier);
      if (resolved?.startsWith(STDLIB_SRC_ROOT)) queue.push(resolved);
    }
  }

  return files;
};

export const loadScriptIntelligenceTypeFiles = async (): Promise<ScriptTypeFile[]> => {
  const [tsLibs, stdlibSources] = await Promise.all([collectTypeScriptLibs(), collectStdlibSources()]);
  return [...tsLibs, ...stdlibSources];
};

if (import.meta.main) {
  const files = await loadScriptIntelligenceTypeFiles();
  const totalBytes = files.reduce((sum, file) => sum + file.text.length, 0);
  console.log(`Loaded ${files.length} script intelligence type file(s), ${totalBytes} bytes`);
}
