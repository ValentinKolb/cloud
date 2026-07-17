import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const workspaceRoot = join(import.meta.dir, "..");
const sharedStylesRoot = join(workspaceRoot, "packages", "cloud", "src", "styles");
const packagesRoot = join(workspaceRoot, "packages");
const globalStylesheet = join(sharedStylesRoot, "global.css");
const forbiddenSharedStylesheets = new Set(["theme-modern.css"]);
const canonicalSharedStylesheetImports: readonly string[] = [
  "tokens.css",
  "utilities-buttons.css",
  "utilities-layout.css",
  "utilities-navigation.css",
  "utilities-feedback.css",
  "utilities-detail.css",
  "utilities-data.css",
  "utilities-table-tile.css",
  "utilities-script.css",
  "utilities-markdown-editor.css",
  "utilities-completion.css",
  "utilities-code-display.css",
  "base-popover.css",
  "effects.css",
  "input.css",
];

const violations: string[] = [];

const report = (file: string, message: string): void => {
  violations.push(`${relative(workspaceRoot, file)}: ${message}`);
};

const withoutCssComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "");

const readCssFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((file) => statSync(file).isFile() && file.endsWith(".css"))
    .sort();
};

const readSourceFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "build" || entry === "dist" || entry === "node_modules") return [];
    const file = join(dir, entry);
    if (statSync(file).isDirectory()) return readSourceFiles(file);
    return /\.(?:css|js|jsx|ts|tsx)$/.test(file) ? [file] : [];
  });
};

const sharedStylesheets = readCssFiles(sharedStylesRoot);
const appStylesheets = readdirSync(packagesRoot)
  .map((packageName) => join(packagesRoot, packageName, "src", "styles", "app.css"))
  .filter(existsSync)
  .sort();

for (const file of sharedStylesheets) {
  const name = relative(sharedStylesRoot, file);
  if (forbiddenSharedStylesheets.has(name)) {
    report(file, "deleted legacy stylesheet must not be reintroduced");
  }
}

// Mail still consumes one compatibility shadow while its active redesign owns
// that surface. No other legacy theme reference is accepted.
const transitionalThemeReferences = new Map([["packages/mail/src/frontend/MailOverview.island.tsx", new Set(["--theme-shadow-elevated"])]]);

for (const file of [...sharedStylesheets, ...appStylesheets]) {
  const source = withoutCssComments(readFileSync(file, "utf8"));
  if (source.includes("cloud-soft-ui")) report(file, "legacy cloud-soft-ui selectors are forbidden");
}

for (const file of readSourceFiles(packagesRoot)) {
  const source = withoutCssComments(readFileSync(file, "utf8"));
  const allowed = transitionalThemeReferences.get(relative(workspaceRoot, file)) ?? new Set<string>();
  for (const match of source.matchAll(/var\(\s*(--theme-[A-Za-z0-9_-]+)/g)) {
    if (!allowed.has(match[1]!)) report(file, `${match[1]} must use a semantic --ui-* role`);
  }
}

for (const [path, properties] of transitionalThemeReferences) {
  const file = join(workspaceRoot, path);
  const source = existsSync(file) ? readFileSync(file, "utf8") : "";
  for (const property of properties) {
    if (!source.includes(`var(${property})`)) {
      report(file, `remove the ${property} compatibility exception after migrating this consumer`);
    }
  }
}

const globalSource = readFileSync(globalStylesheet, "utf8");
const importedSharedStylesheets = [...globalSource.matchAll(/@import\s+["']\.\/(.+?\.css)["'];/g)].map((match) => match[1]!);
const hasCanonicalImportOrder =
  importedSharedStylesheets.length === canonicalSharedStylesheetImports.length &&
  importedSharedStylesheets.every((stylesheet, index) => stylesheet === canonicalSharedStylesheetImports[index]);
if (!hasCanonicalImportOrder) {
  report(
    globalStylesheet,
    `shared stylesheet imports must match the canonical cascade order: ${canonicalSharedStylesheetImports.join(", ")} (found: ${importedSharedStylesheets.join(", ")})`,
  );
}

for (const file of sharedStylesheets) {
  if (file === globalStylesheet) continue;
  const name = relative(sharedStylesRoot, file);
  if (!forbiddenSharedStylesheets.has(name) && !canonicalSharedStylesheetImports.includes(name)) {
    report(file, "shared stylesheet must be added to the canonical import order");
  }
}
for (const name of canonicalSharedStylesheetImports) {
  if (!existsSync(join(sharedStylesRoot, name))) report(globalStylesheet, `canonical import references missing stylesheet ${name}`);
}

const utilityOwners = new Map<string, string[]>();
for (const file of sharedStylesheets) {
  const source = withoutCssComments(readFileSync(file, "utf8"));
  for (const match of source.matchAll(/^@utility\s+([A-Za-z0-9_-]+)/gm)) {
    const name = match[1]!;
    utilityOwners.set(name, [...(utilityOwners.get(name) ?? []), file]);
  }
}
for (const [name, owners] of utilityOwners) {
  if (owners.length < 2) continue;
  report(owners[0]!, `@utility ${name} has multiple owners: ${owners.map((file) => relative(workspaceRoot, file)).join(", ")}`);
}
const customPropertyOwners = new Map<string, Set<string>>();
const customPropertyReferences = new Map<string, Set<string>>();
for (const file of [...sharedStylesheets, ...appStylesheets]) {
  const source = withoutCssComments(readFileSync(file, "utf8"));
  const propertiesDefinedInFile = new Set([...source.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((match) => match[1]!));
  for (const property of propertiesDefinedInFile) {
    customPropertyOwners.set(property, new Set([...(customPropertyOwners.get(property) ?? []), file]));
  }
  for (const match of source.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
    const property = match[1]!;
    customPropertyReferences.set(property, new Set([...(customPropertyReferences.get(property) ?? []), file]));
  }
}

for (const [property, owners] of customPropertyOwners) {
  if (owners.size < 2) continue;
  report([...owners][0]!, `${property} has multiple owner files: ${[...owners].map((file) => relative(workspaceRoot, file)).join(", ")}`);
}

const runtimePropertyPrefixes = ["--app-", "--color-", "--sidebar-", "--tw-", "--workspace-"];
const componentRuntimeProperties = new Set(["--ac-h", "--md-h"]);
for (const [property, consumers] of customPropertyReferences) {
  if (customPropertyOwners.has(property)) continue;
  if (runtimePropertyPrefixes.some((prefix) => property.startsWith(prefix))) continue;
  if (componentRuntimeProperties.has(property)) continue;
  report([...consumers][0]!, `${property} is referenced but has no CSS or documented runtime owner`);
}

for (const file of appStylesheets) {
  const source = readFileSync(file, "utf8");

  const hasScopedImport = source.includes('@import "tailwindcss/utilities.css" layer(utilities);');
  const hasFullImport = source.includes('@import "tailwindcss";');
  if (!hasScopedImport || hasFullImport) {
    report(file, "app styles must use the scoped `tailwindcss/utilities.css` import");
  }

  if (!source.includes('@source "../**/*.{ts,tsx}";')) {
    report(file, "app styles must scan only their own `../**/*.{ts,tsx}` sources");
  }
  for (const match of source.matchAll(/@source\s+["'](.+?)["'];/g)) {
    if (match[1] !== "../**/*.{ts,tsx}") report(file, `cross-package or non-standard @source is forbidden: ${match[1]}`);
  }
  if (!source.includes("@custom-variant dark (&:where(.dark, .dark *));")) {
    report(file, "app styles must use the shared dark-mode variant contract");
  }
}

const buildSource = readFileSync(join(workspaceRoot, "packages", "cloud", "scripts", "build.ts"), "utf8");
const preloadSource = readFileSync(join(workspaceRoot, "packages", "cloud", "scripts", "preload.ts"), "utf8");
for (const [file, source] of [
  [join(workspaceRoot, "packages", "cloud", "scripts", "build.ts"), buildSource],
  [join(workspaceRoot, "packages", "cloud", "scripts", "preload.ts"), preloadSource],
] as const) {
  if (!source.includes("src/styles/app.css") || !source.includes("plugins: [tailwind]")) {
    report(file, "production and development must both build the app-owned src/styles/app.css with Tailwind");
  }
}

if (violations.length > 0) {
  console.error("CSS architecture check failed:\n");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`CSS architecture check passed (${sharedStylesheets.length} shared stylesheets, ${appStylesheets.length} app entrypoints).`);
