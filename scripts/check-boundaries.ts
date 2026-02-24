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

const allowedCoreSubpath = (specifier: string): boolean =>
  /^@valentinkolb\/cloud\/core(?:$|\/(?:config|ssr|services|settings)(?:\/|$))/.test(specifier);

const allowedServerSubpath = (specifier: string): boolean => /^@valentinkolb\/cloud\/lib\/server(?:\/|$)/.test(specifier);

const allowedContractsSubpath = (specifier: string): boolean =>
  /^@valentinkolb\/cloud\/contracts\/(?:app|shared)(?:\/|$)/.test(specifier);

const allowedClientSubpath = (specifier: string): boolean =>
  specifier === "@valentinkolb/cloud/lib/ui" ||
  specifier === "@valentinkolb/cloud/lib/browser" ||
  specifier === "@valentinkolb/cloud/lib/shared" ||
  specifier === "@valentinkolb/cloud/lib/islands" ||
  specifier.startsWith("@valentinkolb/cloud/lib/styles/");

const checkAppsBoundaries = (): Violation[] => {
  const srcRoot = join(workspaceRoot, "packages", "apps", "src");
  const files = readFiles(srcRoot);
  const violations: Violation[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const { specifier, index } of extractSpecifiers(source)) {
      const line = lineFromIndex(source, index);

      if (specifier.startsWith("@/core/") || specifier.startsWith("@/shared/")) {
        violations.push({
          file,
          line,
          specifier,
          message: "cloud-apps must not import cloud-core internals via @/core or @/shared.",
        });
        continue;
      }

      if (specifier === "@/client" || specifier.startsWith("@/client/")) {
        violations.push({
          file,
          line,
          specifier,
          message: "Use app-scoped api clients via @/<app>/client. Global @/client is forbidden.",
        });
        continue;
      }

      if (specifier === "@valentinkolb/cloud-apps/client" || specifier.startsWith("@valentinkolb/cloud-apps/client/")) {
        violations.push({
          file,
          line,
          specifier,
          message: "Use app-scoped api clients via @valentinkolb/cloud-apps/apps/<app>/client.",
        });
        continue;
      }

      if (/^@valentinkolb\/cloud-(apps|core|lib|contracts)(?:\/|$)/.test(specifier)) {
        violations.push({
          file,
          line,
          specifier,
          message: "Use @valentinkolb/cloud/<core|lib|contracts|apps> root subpaths in cloud-apps.",
        });
        continue;
      }

      if (specifier === "@config") {
        violations.push({
          file,
          line,
          specifier,
          message: "Use @valentinkolb/cloud/core/config instead of @config in cloud-apps.",
        });
        continue;
      }

      if (specifier.includes("../core/src") || specifier.includes("../core/config")) {
        violations.push({
          file,
          line,
          specifier,
          message: "Do not import cloud-core via filesystem paths from cloud-apps.",
        });
        continue;
      }

      if (specifier.startsWith("@valentinkolb/cloud/core") && !allowedCoreSubpath(specifier)) {
        violations.push({
          file,
          line,
          specifier,
          message: "cloud-apps may only import @valentinkolb/cloud/core root or /config or /ssr or /services or /settings.",
        });
      }

      if (specifier.startsWith("@valentinkolb/cloud/lib/server") && !allowedServerSubpath(specifier)) {
        violations.push({
          file,
          line,
          specifier,
          message: "cloud-apps may only import @valentinkolb/cloud/lib/server.",
        });
      }

      if (specifier.startsWith("@valentinkolb/cloud/contracts") && !allowedContractsSubpath(specifier)) {
        violations.push({
          file,
          line,
          specifier,
          message: "cloud-apps may only import @valentinkolb/cloud/contracts/app or /shared.",
        });
      }

      if (
        specifier.startsWith("@valentinkolb/cloud/lib") &&
        !specifier.startsWith("@valentinkolb/cloud/lib/server") &&
        !allowedClientSubpath(specifier)
      ) {
        violations.push({
          file,
          line,
          specifier,
          message: "cloud-apps may only import @valentinkolb/cloud/lib /ui, /browser, /shared, /islands, or /styles/*.",
        });
      }
    }
  }

  return violations;
};

const violations = [...checkAppsBoundaries()];

const forbiddenContractsSubpaths = (specifier: string): boolean =>
  specifier === "@valentinkolb/cloud-contracts" ||
  /^@valentinkolb\/cloud-contracts\/(?:schemas|pagination|utils)(?:\/|$)/.test(specifier) ||
  specifier === "@valentinkolb/cloud/contracts" ||
  /^@valentinkolb\/cloud\/contracts\/(?:schemas|pagination|utils)(?:\/|$)/.test(specifier);

const checkForbiddenContractsSubpaths = (): Violation[] => {
  const packageRoots = ["apps", "core", "lib", "standalone", "contracts"].map((name) =>
    join(workspaceRoot, "packages", name, "src"),
  );
  const violations: Violation[] = [];

  for (const root of packageRoots) {
    const files = readFiles(root);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const { specifier, index } of extractSpecifiers(source)) {
        if (!forbiddenContractsSubpaths(specifier)) continue;
        violations.push({
          file,
          line: lineFromIndex(source, index),
          specifier,
          message: "Use explicit contracts subpaths: @valentinkolb/cloud/contracts/app or /shared.",
        });
      }
    }
  }

  return violations;
};

violations.push(...checkForbiddenContractsSubpaths());

const checkClientNamespaceImports = (): Violation[] => {
  const srcRoot = join(workspaceRoot, "packages", "apps", "src");
  const files = readFiles(srcRoot);
  const violations: Violation[] = [];

  const forbiddenBrowserValues = new Set(["createApiClient", "createMutation", "createDebounce", "createInterval", "copyToClipboard", "isImageUrl"]);
  const forbiddenUiUtilityValues = new Set([
    "renderMarkdown",
    "renderMarkdownSync",
    "formatDate",
    "formatDateTime",
    "formatDateRelative",
    "parseCalendarDate",
    "getDateRange",
    "buildCalendarUrl",
    "getMonthGrid",
    "getWeekDays",
    "getDayItems",
    "isToday",
    "isSameMonth",
    "formatDayNumber",
    "formatDateKey",
    "formatWeekdayShort",
    "formatTime",
    "startOfWeek",
    "addMonths",
    "addWeeks",
    "today",
    "MONTHS",
    "WEEKDAYS_SHORT",
    "getYearOptions",
    "ICON_OPTIONS",
    "toBase64",
    "fromBase64",
    "toHex",
    "fromHex",
    "toBase32",
    "fromBase32",
    "getFileIcon",
    "getFileCategory",
  ]);

  const importNamed = (source: string, specifier: string) => {
    const regex = new RegExp(`import\\\\s*\\\\{([^}]+)\\\\}\\\\s*from\\\\s*["']${specifier}["']`, "g");
    const results: Array<{ names: string[]; index: number }> = [];
    let match = regex.exec(source);
    while (match !== null) {
      const names = match[1]!
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => name.replace(/^type\\s+/, ""))
        .map((name) => name.split(/\s+as\s+/)[0]!.trim());
      results.push({ names, index: match.index });
      match = regex.exec(source);
    }
    return results;
  };

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    for (const entry of importNamed(source, "@valentinkolb/cloud/lib/browser")) {
      for (const name of entry.names) {
        if (!forbiddenBrowserValues.has(name)) continue;
        violations.push({
          file,
          line: lineFromIndex(source, entry.index),
          specifier: `@valentinkolb/cloud/lib/browser:${name}`,
          message: "Use namespaced browser APIs (api.create, mutation.create, timing.*, clipboard.copy, url.isImage).",
        });
      }
    }

    for (const entry of importNamed(source, "@valentinkolb/cloud/lib/ui")) {
      for (const name of entry.names) {
        if (!forbiddenUiUtilityValues.has(name)) continue;
        violations.push({
          file,
          line: lineFromIndex(source, entry.index),
          specifier: `@valentinkolb/cloud/lib/ui:${name}`,
          message: "UI package must not be used for shared utilities. Import these from @valentinkolb/cloud/lib/shared.",
        });
      }
    }
  }

  return violations;
};

violations.push(...checkClientNamespaceImports());

const checkCoreServerBoundaries = (): Violation[] => {
  const coreRoot = join(workspaceRoot, "packages", "core", "src");
  const serverRoot = join(workspaceRoot, "packages", "lib", "src", "server");
  const violations: Violation[] = [];

  const coreFiles = readFiles(coreRoot);
  for (const file of coreFiles) {
    const source = readFileSync(file, "utf8");
    for (const { specifier, index } of extractSpecifiers(source)) {
      if (
        specifier.startsWith("@/core/services/") ||
        specifier.startsWith("@/core/middleware/") ||
        specifier === "@/core/api/respond" ||
        specifier.startsWith("@/core/api/respond/")
      ) {
        violations.push({
          file,
          line: lineFromIndex(source, index),
          specifier,
          message: "cloud-core must use @valentinkolb/cloud-lib/server/* for services/middleware/respond.",
        });
      }
    }
  }

  const forbiddenCorePaths = [
    join(coreRoot, "core", "services"),
    join(coreRoot, "core", "middleware"),
    join(coreRoot, "core", "api", "respond.ts"),
  ];
  for (const forbiddenPath of forbiddenCorePaths) {
    if (!existsSync(forbiddenPath)) continue;

    if (statSync(forbiddenPath).isFile()) {
      violations.push({
        file: forbiddenPath,
        line: 1,
        specifier: relative(coreRoot, forbiddenPath),
        message: "Deprecated core internal backend file is forbidden.",
      });
      continue;
    }

    for (const file of readFiles(forbiddenPath)) {
      violations.push({
        file,
        line: 1,
        specifier: relative(coreRoot, file),
        message: "Deprecated core internal backend directory is forbidden.",
      });
    }
  }

  const serverFiles = readFiles(serverRoot);
  for (const file of serverFiles) {
    const source = readFileSync(file, "utf8");
    for (const { specifier, index } of extractSpecifiers(source)) {
      if (
        specifier.startsWith("@valentinkolb/cloud-core") &&
        !/^@valentinkolb\/cloud-core\/(?:config|services)(?:\/|$)/.test(specifier)
      ) {
        violations.push({
          file,
          line: lineFromIndex(source, index),
          specifier,
          message: "cloud-lib/server may only import @valentinkolb/cloud-core/config or /services/*.",
        });
      }

      if (specifier.startsWith("@/public/")) {
        violations.push({
          file,
          line: lineFromIndex(source, index),
          specifier,
          message: "lib/src/server/public/* is deprecated. Use explicit root exports in src/server/index.ts.",
        });
      }
    }
  }

  const deprecatedServerPublic = join(serverRoot, "public");
  if (existsSync(deprecatedServerPublic)) {
    for (const file of readFiles(deprecatedServerPublic)) {
      violations.push({
        file,
        line: 1,
        specifier: relative(serverRoot, file),
        message: "lib/src/server/public/* is deprecated. Remove this folder.",
      });
    }
  }

  return violations;
};

violations.push(...checkCoreServerBoundaries());

const checkContractsSharedDrift = (): Violation[] => {
  const sharedFile = join(workspaceRoot, "packages", "contracts", "src", "shared.ts");
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
