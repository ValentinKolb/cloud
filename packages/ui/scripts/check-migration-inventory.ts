import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import * as ts from "typescript";

type MigrationStatus = "implemented" | "planned";
type GenericEntry = { source: string; status: MigrationStatus };
type AdditionalSource = {
  source: string;
  exports: Array<{ name: string; status: MigrationStatus }>;
};
type Inventory = {
  generic: Record<string, GenericEntry[]>;
  additionalSources?: AdditionalSource[];
  cloudSpecific: string[];
  deprecated: string[];
};

const packageRoot = resolve(import.meta.dir, "..");
const cloudUiRoot = resolve(packageRoot, "../cloud/src/ui");
const inventory = JSON.parse(readFileSync(join(packageRoot, "migration-inventory.json"), "utf8")) as Inventory;

const resolveModule = (fromFile: string, specifier: string): string => {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  const file = candidates.find(existsSync);
  if (!file) throw new Error(`Cannot resolve ${specifier} from ${relative(packageRoot, fromFile)}`);
  return file;
};

const moduleName = (file: string): string => {
  let name = relative(cloudUiRoot, file).replaceAll("\\", "/");
  name = name.slice(0, -extname(name).length).replace(/\/index$/, "");
  return name.startsWith("..") ? name : `./${name}`;
};

const exportedByModule = new Map<string, Set<string>>();
const visited = new Set<string>();

const visitBarrel = (file: string) => {
  if (visited.has(file)) return;
  visited.add(file);

  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const target = resolveModule(file, statement.moduleSpecifier.text);
    if (!statement.exportClause) {
      visitBarrel(target);
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;

    const name = moduleName(target);
    const exports = exportedByModule.get(name) ?? new Set<string>();
    for (const element of statement.exportClause.elements) exports.add(element.name.text);
    exportedByModule.set(name, exports);
  }
};

visitBarrel(join(cloudUiRoot, "index.ts"));

const exportedNames = (file: string): Set<string> => {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const names = new Set<string>();

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.add(element.name.text);
      continue;
    }

    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
      continue;
    }

    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
    }
  }

  return names;
};

const classified = [
  ...Object.values(inventory.generic)
    .flat()
    .map((entry) => entry.source),
  ...inventory.cloudSpecific,
  ...inventory.deprecated,
];
const classifiedSet = new Set(classified);
const publicModules = new Set(exportedByModule.keys());
const duplicates = classified.filter((source, index) => classified.indexOf(source) !== index);
const missing = [...publicModules].filter((source) => !classifiedSet.has(source));
const stale = [...classifiedSet].filter((source) => !publicModules.has(source));

if (duplicates.length || missing.length || stale.length) {
  if (duplicates.length) console.error(`Duplicate classifications:\n- ${[...new Set(duplicates)].sort().join("\n- ")}`);
  if (missing.length) {
    console.error(
      `Missing classifications:\n- ${missing
        .sort()
        .map((source) => `${source}: ${[...(exportedByModule.get(source) ?? [])].sort().join(", ")}`)
        .join("\n- ")}`,
    );
  }
  if (stale.length) console.error(`Stale classifications:\n- ${stale.sort().join("\n- ")}`);
  process.exit(1);
}

for (const additional of inventory.additionalSources ?? []) {
  const file = resolve(packageRoot, "../..", additional.source);
  if (!existsSync(file)) {
    console.error(`Additional migration source does not exist: ${additional.source}`);
    process.exit(1);
  }

  const actual = exportedNames(file);
  const classifiedNames = additional.exports.map((entry) => entry.name);
  const classifiedNameSet = new Set(classifiedNames);
  const duplicateNames = classifiedNames.filter((name, index) => classifiedNames.indexOf(name) !== index);
  const missingNames = [...actual].filter((name) => !classifiedNameSet.has(name));
  const staleNames = [...classifiedNameSet].filter((name) => !actual.has(name));

  if (duplicateNames.length || missingNames.length || staleNames.length) {
    if (duplicateNames.length) console.error(`Duplicate exports in ${additional.source}:\n- ${[...new Set(duplicateNames)].sort().join("\n- ")}`);
    if (missingNames.length) console.error(`Missing exports in ${additional.source}:\n- ${missingNames.sort().join("\n- ")}`);
    if (staleNames.length) console.error(`Stale exports in ${additional.source}:\n- ${staleNames.sort().join("\n- ")}`);
    process.exit(1);
  }
}

const exportCount = [...exportedByModule.values()].reduce((count, exports) => count + exports.size, 0);
const additionalExportCount = (inventory.additionalSources ?? []).reduce((count, source) => count + source.exports.length, 0);
console.log(
  `Migration inventory covers ${exportCount} public exports from ${publicModules.size} UI modules and ${additionalExportCount} exports from ${
    inventory.additionalSources?.length ?? 0
  } additional source(s).`,
);
