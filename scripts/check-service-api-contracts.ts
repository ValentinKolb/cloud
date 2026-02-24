import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type Violation = {
  file: string;
  message: string;
};

const workspaceRoot = join(import.meta.dir, "..");
const appsRoot = join(workspaceRoot, "packages", "apps", "src");

const isDirectory = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

const appDirs = readdirSync(appsRoot)
  .map((name) => join(appsRoot, name))
  .filter(isDirectory)
  .sort();

const violations: Violation[] = [];

const firstIndex = (source: string, patterns: RegExp[]): number => {
  let out = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match || match.index === undefined) continue;
    if (out === -1 || match.index < out) out = match.index;
  }
  return out;
};

const hasMatch = (source: string, pattern: RegExp): boolean => pattern.test(source);

const extractSpecifiers = (source: string): string[] => {
  const out: string[] = [];
  const importExportRe = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;

  let match: RegExpExecArray | null = importExportRe.exec(source);
  while (match !== null) {
    out.push(match[1]!);
    match = importExportRe.exec(source);
  }

  const dynamicImportRe = /import\(\s*["']([^"']+)["']\s*\)/g;
  match = dynamicImportRe.exec(source);
  while (match !== null) {
    out.push(match[1]!);
    match = dynamicImportRe.exec(source);
  }

  return out;
};

const importsNamed = (source: string, specifier: string, name: string): boolean => {
  const re = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']${specifier}["']`);
  return re.test(source);
};

for (const appDir of appDirs) {
  const appName = appDir.split("/").at(-1)!;
  const indexPath = join(appDir, "index.ts");
  const apiPath = join(appDir, "api.ts");
  const serviceIndexPath = join(appDir, "service", "index.ts");

  if (!existsSync(indexPath)) {
    violations.push({ file: indexPath, message: "Missing app index.ts facade file." });
    continue;
  }

  const indexSource = readFileSync(indexPath, "utf8");
  if (!/export\s+default\s+\w+\s*;?/.test(indexSource)) {
    violations.push({
      file: indexPath,
      message: "App facade must export a default runtime value.",
    });
  }

  if (!/export\s*\{\s*\w+\s+as\s+service\s*\}\s*;?/.test(indexSource)) {
    violations.push({
      file: indexPath,
      message: "App facade must export named runtime service as 'service'.",
    });
  }

  if (existsSync(apiPath) && !/export\s+type\s+\{\s*ApiType\s*\}\s+from\s+["']\.\/api["']/.test(indexSource)) {
    violations.push({
      file: indexPath,
      message: "Apps with api.ts must re-export 'type ApiType' from ./api.",
    });
  }

  if (existsSync(serviceIndexPath)) {
    const serviceSource = readFileSync(serviceIndexPath, "utf8");

    if (/\bclass\s+\w+/.test(serviceSource)) {
      violations.push({
        file: serviceIndexPath,
        message: "Service modules must stay functional/stateless (no classes).",
      });
    }

    if (/export\s+default\s+/.test(serviceSource)) {
      violations.push({
        file: serviceIndexPath,
        message: "Service modules must use named exports, not default export.",
      });
    }

    if (!/export\s+const\s+\w+Service\s*=\s*\{/.test(serviceSource)) {
      violations.push({
        file: serviceIndexPath,
        message: "service/index.ts must export a '*Service' facade object.",
      });
    }
  }

  if (!existsSync(apiPath)) continue;

  const apiSource = readFileSync(apiPath, "utf8");
  const apiSpecifiers = extractSpecifiers(apiSource);
  const hasDirectRoutes = hasMatch(apiSource, /^\s*\.(get|post|put|patch|delete)\(/m);

  const hasServerImport = apiSpecifiers.includes("@valentinkolb/cloud/lib/server") || apiSpecifiers.includes("@valentinkolb/cloud-lib/server");

  if (hasDirectRoutes && !hasServerImport) {
    violations.push({
      file: apiPath,
      message: "api.ts must import respond from @valentinkolb/cloud/lib/server.",
    });
  }

  if (hasDirectRoutes && !/\brespond\(/.test(apiSource)) {
    violations.push({
      file: apiPath,
      message: "api.ts must map service results through respond(...).",
    });
  }

  const firstUse = firstIndex(apiSource, [/^\s*\.use\(/gm]);
  const firstRoute = firstIndex(apiSource, [/^\s*\.get\(/gm, /^\s*\.post\(/gm, /^\s*\.put\(/gm, /^\s*\.patch\(/gm, /^\s*\.delete\(/gm]);

  if (hasDirectRoutes && firstRoute !== -1 && (firstUse === -1 || firstUse > firstRoute)) {
    violations.push({
      file: apiPath,
      message: "Middleware should be mounted before route handlers.",
    });
  }

  if (/\bc\.(json|html)\(/.test(apiSource)) {
    violations.push({
      file: apiPath,
      message: "Prefer respond(...) and result helpers over direct c.json/c.html responses.",
    });
  }

  if (apiSpecifiers.some((specifier) => /^@\/(core|shared)\//.test(specifier))) {
    violations.push({
      file: apiPath,
      message: "api.ts must not import internal aliases (@/core or @/shared).",
    });
  }

  if (
    apiSpecifiers.some(
      (specifier) =>
        specifier.includes("/src/") ||
        specifier.includes("../core/") ||
        specifier.includes("../lib/") ||
        specifier.includes("../contracts/"),
    )
  ) {
    violations.push({
      file: apiPath,
      message: "api.ts must use public package surfaces, not deep filesystem imports.",
    });
  }

  const hasRateLimitImport =
    apiSpecifiers.includes("@valentinkolb/cloud/lib/server/middleware/rate-limit") ||
    apiSpecifiers.includes("@valentinkolb/cloud-lib/server/middleware/rate-limit") ||
    importsNamed(apiSource, "@valentinkolb/cloud/lib/server", "rateLimit") ||
    importsNamed(apiSource, "@valentinkolb/cloud-lib/server", "rateLimit");

  if (hasRateLimitImport && !/\.use\(\s*rateLimit\(/.test(apiSource)) {
    violations.push({
      file: apiPath,
      message: "rateLimit middleware imported but not mounted.",
    });
  }

  if (!hasRateLimitImport && appName !== "files") {
    violations.push({
      file: apiPath,
      message: "App APIs should include rateLimit middleware unless explicitly exempt (files upload/thumbnail throughput exception).",
    });
  }
}

if (violations.length > 0) {
  console.error("Service/API contract check failed:\n");
  for (const violation of violations) {
    console.error(`- ${relative(workspaceRoot, violation.file)} ${violation.message}`);
  }
  process.exit(1);
}

console.log("Service/API contract check passed.");
