import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const uiIndex = path.join(repoRoot, "packages/cloud/src/ui/index.ts");
const uiLabRoot = path.join(repoRoot, "packages/ui-lab/src/frontend");
const registryFile = path.join(uiLabRoot, "docs/registry.tsx");

const identifierBoundary = (name: string) => new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(name)}([^A-Za-z0-9_$]|$)`);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveExportTarget(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function parseExportNames(block: string): string[] {
  return block
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("type "))
    .map((part) => part.replace(/^default\s+as\s+/, ""))
    .map((part) => {
      const alias = part.split(/\s+as\s+/);
      return (alias[1] ?? alias[0] ?? "").trim();
    })
    .filter(Boolean);
}

function collectRuntimeExports(file: string, seen = new Set<string>(), names = new Set<string>()): Set<string> {
  const resolved = path.resolve(file);
  if (seen.has(resolved)) return names;
  seen.add(resolved);

  const source = readFileSync(resolved, "utf8");
  for (const match of source.matchAll(/export\s+\{([\s\S]*?)\}\s+from\s+["'](.+?)["']/g)) {
    for (const name of parseExportNames(match[1] ?? "")) names.add(name);
  }

  for (const match of source.matchAll(/export\s+\*\s+from\s+["'](.+?)["']/g)) {
    const target = resolveExportTarget(resolved, match[1] ?? "");
    if (target) collectRuntimeExports(target, seen, names);
  }

  for (const match of source.matchAll(/export\s+(?:const|function|class)\s+([A-Za-z0-9_]+)/g)) {
    if (match[1]) names.add(match[1]);
  }

  return names;
}

function walkFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    return stat.isDirectory() ? walkFiles(full) : [full];
  });
}

function parseHiddenExports(registrySource: string): Set<string> {
  const match = registrySource.match(/export const hiddenUiLabExports = \[([\s\S]*?)\] as const;/);
  if (!match?.[1]) return new Set();
  const namedEntries = [...match[1].matchAll(/\bname:\s*"([^"]+)"/g)].map((item) => item[1]!).filter(Boolean);
  if (namedEntries.length > 0) return new Set(namedEntries);
  return new Set([...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]!).filter(Boolean));
}

const registrySource = readFileSync(registryFile, "utf8");
const hiddenExports = parseHiddenExports(registrySource);
const runtimeExports = [...collectRuntimeExports(uiIndex)].sort();

const uiLabSource = walkFiles(uiLabRoot)
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")
  .replace(/export const hiddenUiLabExports = \[[\s\S]*?\] as const;/, "");

const missing = runtimeExports.filter((name) => !hiddenExports.has(name) && !identifierBoundary(name).test(uiLabSource));
const staleHidden = [...hiddenExports].filter((name) => !runtimeExports.includes(name)).sort();

if (missing.length > 0 || staleHidden.length > 0) {
  console.error("UI Lab coverage check failed.");
  if (missing.length > 0) {
    console.error("\nPublic @valentinkolb/cloud/ui exports missing from UI Lab or hiddenUiLabExports:");
    for (const name of missing) console.error(`- ${name}`);
  }
  if (staleHidden.length > 0) {
    console.error("\nhiddenUiLabExports entries that are no longer public exports:");
    for (const name of staleHidden) console.error(`- ${name}`);
  }
  process.exit(1);
}

console.log(`UI Lab coverage check passed (${runtimeExports.length} runtime exports, ${hiddenExports.size} intentionally hidden).`);
