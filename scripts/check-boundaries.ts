import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type Violation = {
  file: string;
  line: number;
  specifier: string;
  message: string;
};

const workspaceRoot = join(import.meta.dir, "..");

const readFiles = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      readFiles(path, out);
      continue;
    }
    if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
};

const extractSpecifiers = (source: string): Array<{ specifier: string; index: number }> => {
  const matches: Array<{ specifier: string; index: number }> = [];

  const importExportRe = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
  let match: RegExpExecArray | null = importExportRe.exec(source);
  while (match !== null) {
    matches.push({ specifier: match[1]!, index: match.index });
    match = importExportRe.exec(source);
  }

  const dynamicImportRe = /import\(\s*["']([^"']+)["']\s*\)/g;
  match = dynamicImportRe.exec(source);
  while (match !== null) {
    matches.push({ specifier: match[1]!, index: match.index });
    match = dynamicImportRe.exec(source);
  }

  return matches;
};

const lineFromIndex = (source: string, index: number): number => source.slice(0, index).split("\n").length;

// Allowed @valentinkolb/cloud subpath imports from apps
const allowedCloudSubpath = (specifier: string): boolean =>
  /^@valentinkolb\/cloud(?:$|\/(ui|desktop|server|browser|cli|shared|services|ai|ssr|config|contracts|api|clients|workflows)(?:\/|$))/.test(
    specifier,
  );

const allowedSubpathList =
  "/ui, /desktop, /server, /browser, /cli, /shared, /services, /ai, /ssr, /config, /contracts, /api, /clients, /workflows";

const APP_PACKAGE_NAMES = readdirSync(join(workspaceRoot, "packages")).filter(
  (name) => name !== "cloud" && existsSync(join(workspaceRoot, "packages", name, "src")),
);

const checkAppsBoundaries = (): Violation[] => {
  const violations: Violation[] = [];

  for (const appName of APP_PACKAGE_NAMES) {
    const srcRoot = join(workspaceRoot, "packages", appName, "src");
    const files = readFiles(srcRoot);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const { specifier, index } of extractSpecifiers(source)) {
        const line = lineFromIndex(source, index);

        // Forbid old-style package imports
        if (/^@valentinkolb\/cloud-(apps|core|lib|contracts)(?:\/|$)/.test(specifier)) {
          violations.push({
            file,
            line,
            specifier,
            message: "Use @valentinkolb/cloud/<subpath> imports, not old hyphenated package names.",
          });
          continue;
        }

        // Forbid old aliased paths
        if (specifier === "@config") {
          violations.push({
            file,
            line,
            specifier,
            message: "Use @valentinkolb/cloud/config instead of @config.",
          });
          continue;
        }

        // Forbid filesystem cross-package imports (siblings)
        if (specifier.includes("../cloud/src") || specifier.includes("../../cloud/")) {
          violations.push({
            file,
            line,
            specifier,
            message: "Do not import cloud package via filesystem paths from apps.",
          });
          continue;
        }

        // Forbid importing another app's @valentinkolb/cloud-app-* package.
        // Each app is its own container — share via cloud-lib services, not direct imports.
        const otherAppMatch = specifier.match(/^@valentinkolb\/cloud-app-([a-z0-9-]+)/);
        if (otherAppMatch && otherAppMatch[1] !== appName) {
          if (appName === "cloud-cli" && /^@valentinkolb\/cloud-app-[a-z0-9-]+\/cli$/.test(specifier)) {
            continue;
          }
          violations.push({
            file,
            line,
            specifier,
            message: "Cross-app imports are forbidden. Move shared logic to cloud-lib services.",
          });
          continue;
        }

        // Validate @valentinkolb/cloud subpaths
        if (
          specifier.startsWith("@valentinkolb/cloud") &&
          !specifier.startsWith("@valentinkolb/cloud-") &&
          !allowedCloudSubpath(specifier)
        ) {
          violations.push({
            file,
            line,
            specifier,
            message: `Invalid @valentinkolb/cloud subpath. Allowed: ${allowedSubpathList}.`,
          });
        }
      }
    }
  }

  return violations;
};

const violations = [...checkAppsBoundaries()];

// Check contracts/shared doesn't have app-domain symbols
const checkContractsSharedDrift = (): Violation[] => {
  const sharedFile = join(workspaceRoot, "packages", "cloud", "src", "contracts", "shared.ts");
  if (!existsSync(sharedFile)) return [];

  const source = readFileSync(sharedFile, "utf8");
  const lines = source.split("\n");
  const forbiddenPrefixes = ["Space", "File", "OAuth", "ProxyAuth", "Faq", "Terms", "Log"];
  const violations: Violation[] = [];

  const exportNameRe = /^export\s+(?:const|type)\s+([A-Za-z0-9_]+)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(exportNameRe);
    if (!match) continue;

    const symbol = match[1]!;
    if (!forbiddenPrefixes.some((prefix) => symbol.startsWith(prefix))) continue;

    violations.push({
      file: sharedFile,
      line: i + 1,
      specifier: symbol,
      message: "contracts/shared must stay app-agnostic. Move app-domain symbols to owning app contracts.ts.",
    });
  }

  return violations;
};

violations.push(...checkContractsSharedDrift());

if (violations.length > 0) {
  console.error("Boundary check failed:\n");
  for (const violation of violations) {
    console.error(`- ${relative(workspaceRoot, violation.file)}:${violation.line} ${violation.message} (${violation.specifier})`);
  }
  process.exit(1);
}

console.log("Boundary check passed.");
