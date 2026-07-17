import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const workspaceRoot = join(import.meta.dir, "..");
const sharedStylesRoot = join(workspaceRoot, "packages", "cloud", "src", "styles");
const packagesRoot = join(workspaceRoot, "packages");
const globalStylesheet = join(sharedStylesRoot, "global.css");

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

// These are migration debt, not accepted architecture. Keeping the list here
// makes the current baseline executable while preventing new exceptions.
const transitionalDuplicateUtilities = new Set(["bg-dark", "ellipsis", "no-scrollbar"]);
const transitionalThemeStylesheet = "theme-modern.css";
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
const importedCounts = new Map<string, number>();
for (const stylesheet of importedSharedStylesheets) {
  importedCounts.set(stylesheet, (importedCounts.get(stylesheet) ?? 0) + 1);
}

for (const file of sharedStylesheets) {
  if (file === globalStylesheet) continue;
  const name = file.slice(sharedStylesRoot.length + 1);
  const count = importedCounts.get(name) ?? 0;
  if (count !== 1) report(globalStylesheet, `${name} must be imported exactly once (found ${count})`);
}
for (const name of importedCounts.keys()) {
  if (!existsSync(join(sharedStylesRoot, name))) report(globalStylesheet, `imports missing stylesheet ${name}`);
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
  if (owners.length < 2 || transitionalDuplicateUtilities.has(name)) continue;
  report(owners[0]!, `@utility ${name} has multiple owners: ${owners.map((file) => relative(workspaceRoot, file)).join(", ")}`);
}
for (const name of transitionalDuplicateUtilities) {
  const owners = utilityOwners.get(name) ?? [];
  if (owners.length !== 2) {
    report(globalStylesheet, `remove ${name} from transitionalDuplicateUtilities after resolving its duplicate ownership`);
  }
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
  const ownerNames = [...owners].map((file) => file.slice(sharedStylesRoot.length + 1));
  const isFrozenThemeOverride = owners.size === 2 && ownerNames.includes(transitionalThemeStylesheet);
  if (isFrozenThemeOverride) continue;
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

const themeStylesheet = join(sharedStylesRoot, transitionalThemeStylesheet);
if (!existsSync(themeStylesheet) || importedCounts.get(transitionalThemeStylesheet) !== 1) {
  report(globalStylesheet, `remove the ${transitionalThemeStylesheet} migration exception after deleting its final import`);
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
