import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import * as ts from "typescript";
import { barrelTargetError } from "./migration-inventory-contract";

type GenericMigrationStatus = "implemented" | "planned";
type AdditionalMigrationStatus = GenericMigrationStatus | "cloud-owned";
type GenericEntry = {
  source: string;
  status: GenericMigrationStatus;
  target?: string;
  test?: string;
  covers?: string[];
  exportMap?: Record<string, string>;
  allowBarrelTarget?: true;
};
type AdditionalSource = {
  source: string;
  exports: Array<{ name: string; status: AdditionalMigrationStatus }>;
};
type Inventory = {
  version: number;
  source: string;
  generic: Record<string, GenericEntry[]>;
  additionalSources?: AdditionalSource[];
  cloudSpecific: string[];
  deprecated: string[];
};

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const inventory = JSON.parse(readFileSync(join(packageRoot, "migration-inventory.json"), "utf8")) as Inventory;
const inventoryErrors: string[] = [];
const MINIMUM_PUBLIC_EXPORTS = 332;
const MINIMUM_PUBLIC_MODULES = 85;
const MINIMUM_ADDITIONAL_EXPORTS = 19;

if (inventory.version !== 1) {
  inventoryErrors.push(`version must be 1, received ${JSON.stringify(inventory.version)}`);
}

const resolveContainedPath = (root: string, path: unknown, field: string): string | undefined => {
  if (typeof path !== "string" || path.length === 0) {
    inventoryErrors.push(`${field} must be a non-empty relative path`);
    return undefined;
  }

  const file = resolve(root, path);
  const fromRoot = relative(root, file);
  if (isAbsolute(path) || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    inventoryErrors.push(`${field} must stay within ${relative(repositoryRoot, root) || "the repository"}`);
    return undefined;
  }
  if (!existsSync(file)) {
    inventoryErrors.push(`${field} does not exist: ${path}`);
    return undefined;
  }
  return file;
};

const cloudUiEntry = resolveContainedPath(repositoryRoot, inventory.source, "source");
if (cloudUiEntry && ![".ts", ".tsx"].includes(extname(cloudUiEntry))) {
  inventoryErrors.push(`source must be a TypeScript module: ${inventory.source}`);
}

for (const entry of Object.values(inventory.generic).flat()) {
  if (entry.status === "planned") {
    inventoryErrors.push(`${entry.source} is planned; the migration baseline only accepts implemented entries`);
    continue;
  }
  if (entry.status !== "implemented") continue;

  if (entry.allowBarrelTarget !== undefined && entry.allowBarrelTarget !== true) {
    inventoryErrors.push(`${entry.source} allowBarrelTarget must be true when present`);
  }
  const target = resolveContainedPath(packageRoot, entry.target, `${entry.source} target`);
  if (target && ![".ts", ".tsx"].includes(extname(target))) {
    inventoryErrors.push(`${entry.source} target must be a TypeScript module: ${entry.target}`);
  }
  const targetContractError = entry.target ? barrelTargetError(entry.target, entry.allowBarrelTarget) : undefined;
  if (targetContractError) {
    inventoryErrors.push(`${entry.source} ${targetContractError}`);
  }
  const test = resolveContainedPath(packageRoot, entry.test, `${entry.source} test`);
  if (test && !/\.test\.tsx?$/.test(test)) {
    inventoryErrors.push(`${entry.source} test must be a focused .test.ts or .test.tsx file: ${entry.test}`);
  }
  if (entry.covers !== undefined && (!Array.isArray(entry.covers) || entry.covers.length === 0)) {
    inventoryErrors.push(`${entry.source} covers must be a non-empty string array when present`);
  }
  if (entry.covers?.some((name) => typeof name !== "string" || name.length === 0)) {
    inventoryErrors.push(`${entry.source} covers must contain only non-empty names`);
  }
  if (
    entry.exportMap !== undefined &&
    (typeof entry.exportMap !== "object" ||
      entry.exportMap === null ||
      Array.isArray(entry.exportMap) ||
      Object.keys(entry.exportMap).length === 0)
  ) {
    inventoryErrors.push(`${entry.source} exportMap must be a non-empty object when present`);
  }
  if (
    entry.exportMap &&
    Object.entries(entry.exportMap).some(
      ([sourceName, targetName]) =>
        sourceName.length === 0 || typeof targetName !== "string" || targetName.length === 0,
    )
  ) {
    inventoryErrors.push(`${entry.source} exportMap must contain only non-empty export names`);
  }
  if (target && test) {
    const testSource = readFileSync(test, "utf8");
    const targetName = basename(target, extname(target));
    const sourceName = entry.source.slice(entry.source.lastIndexOf("/") + 1);
    const evidenceNames = entry.covers ?? [targetName, sourceName];
    const mentions = (name: string) =>
      new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(testSource);
    const hasEvidence = entry.covers ? evidenceNames.every(mentions) : evidenceNames.some(mentions);
    if (!hasEvidence) {
      inventoryErrors.push(
        `${entry.source} test ${entry.test} does not mention ${entry.covers ? "its declared coverage" : "its source or target"}: ${evidenceNames.join(", ")}`,
      );
    }
  }
}

if (inventoryErrors.length > 0) {
  console.error(`Invalid migration inventory:\n- ${inventoryErrors.join("\n- ")}`);
  process.exit(1);
}

const cloudUiRoot = dirname(cloudUiEntry!);
const validGenericStatuses = new Set<GenericMigrationStatus>(["implemented", "planned"]);
const validAdditionalStatuses = new Set<AdditionalMigrationStatus>([
  ...validGenericStatuses,
  "cloud-owned",
]);
const invalidStatuses = [
  ...Object.values(inventory.generic)
    .flat()
    .filter((entry) => !validGenericStatuses.has(entry.status))
    .map((entry) => `${entry.source}: ${entry.status}`),
  ...(inventory.additionalSources ?? []).flatMap((source) =>
    source.exports
      .filter((entry) => !validAdditionalStatuses.has(entry.status))
      .map((entry) => `${source.source}#${entry.name}: ${entry.status}`),
  ),
];

if (invalidStatuses.length > 0) {
  console.error(`Invalid migration statuses:\n- ${invalidStatuses.join("\n- ")}`);
  process.exit(1);
}

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

const exportedNamesCache = new Map<string, Set<string>>();
type ExportKind = "type" | "value";
type ExportSymbols = Map<string, Set<ExportKind>>;
const exportedSymbolsCache = new Map<string, ExportSymbols>();

const addKind = (symbols: ExportSymbols, name: string, ...kinds: ExportKind[]) => {
  const current = symbols.get(name) ?? new Set<ExportKind>();
  for (const kind of kinds) current.add(kind);
  symbols.set(name, current);
};

const addDeclaredExports = (source: ts.SourceFile, names: Set<string>, symbols?: ExportSymbols) => {
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      names.add("default");
      if (symbols) addKind(symbols, "default", "value");
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (!statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text);
          if (symbols) addKind(symbols, element.name.text, statement.isTypeOnly || element.isTypeOnly ? "type" : "value");
        }
      }
      continue;
    }

    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      names.add("default");
      if (symbols) addKind(symbols, "default", "value");
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.add(declaration.name.text);
          if (symbols) addKind(symbols, declaration.name.text, "value");
        }
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
      if (symbols) {
        if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
          addKind(symbols, statement.name.text, "type");
        } else if (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
          addKind(symbols, statement.name.text, "type", "value");
        } else {
          addKind(symbols, statement.name.text, "value");
        }
      }
    }
  }
};

const exportedSymbols = (file: string): ExportSymbols => {
  const cached = exportedSymbolsCache.get(file);
  if (cached) return cached;

  const symbols: ExportSymbols = new Map();
  exportedSymbolsCache.set(file, symbols);
  const names = new Set<string>();
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  addDeclaredExports(source, names, symbols);

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) {
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        for (const [name, kinds] of exportedSymbols(resolveModule(file, statement.moduleSpecifier.text))) {
          if (name !== "default") addKind(symbols, name, ...kinds);
        }
        continue;
      }

      if (ts.isNamedExports(statement.exportClause)) {
        const target =
          statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
            ? exportedSymbols(resolveModule(file, statement.moduleSpecifier.text))
            : undefined;
        for (const element of statement.exportClause.elements) {
          if (statement.isTypeOnly || element.isTypeOnly) {
            addKind(symbols, element.name.text, "type");
            continue;
          }
          const original = element.propertyName?.text ?? element.name.text;
          const kinds = target?.get(original);
          const resolvedKinds: ExportKind[] = kinds?.size ? [...kinds] : ["value"];
          addKind(symbols, element.name.text, ...resolvedKinds);
        }
      } else {
        addKind(symbols, statement.exportClause.name.text, "value");
      }
      continue;
    }
  }

  return symbols;
};

const exportedNames = (file: string): Set<string> => {
  const cached = exportedNamesCache.get(file);
  if (cached) return cached;
  const names = new Set(exportedSymbols(file).keys());
  exportedNamesCache.set(file, names);
  return names;
};

const exportedByModule = new Map<string, Set<string>>();
const visited = new Set<string>();

const visitBarrel = (file: string) => {
  if (visited.has(file)) return;
  visited.add(file);

  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const target = resolveModule(file, statement.moduleSpecifier.text);
    if (!statement.exportClause) {
      visitBarrel(target);
      continue;
    }

    const name = moduleName(target);
    const exports = exportedByModule.get(name) ?? new Set<string>();
    if (ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exports.add(element.name.text);
    } else {
      exports.add(statement.exportClause.name.text);
    }
    exportedByModule.set(name, exports);
  }

  if (file !== cloudUiEntry) {
    const directExports = exportedByModule.get(moduleName(file)) ?? new Set<string>();
    addDeclaredExports(source, directExports);
    directExports.delete("default");
    if (directExports.size > 0) exportedByModule.set(moduleName(file), directExports);
  }
};

visitBarrel(cloudUiEntry!);

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

const migrationErrors: string[] = [];
for (const entry of Object.values(inventory.generic).flat()) {
  if (entry.status !== "implemented") continue;

  const sourceExports = exportedByModule.get(entry.source) ?? new Set<string>();
  const target = resolve(packageRoot, entry.target!);
  const sourceModule = resolve(cloudUiRoot, entry.source);
  const sourceFile = [
    `${sourceModule}.ts`,
    `${sourceModule}.tsx`,
    join(sourceModule, "index.ts"),
    join(sourceModule, "index.tsx"),
  ].find(existsSync);
  const sourceSymbols = sourceFile ? exportedSymbols(sourceFile) : new Map<string, Set<ExportKind>>();
  const targetSymbols = exportedSymbols(target);
  const staleMappings = Object.keys(entry.exportMap ?? {}).filter((name) => !sourceExports.has(name));
  if (staleMappings.length > 0) {
    migrationErrors.push(
      `${entry.source} exportMap contains exports not exposed by the Cloud barrel: ${staleMappings.sort().join(", ")}`,
    );
  }
  const missingTargetExports = [...sourceExports].filter((name) => {
    const required = sourceSymbols.get(name) ?? new Set<ExportKind>(["value"]);
    const actual = targetSymbols.get(entry.exportMap?.[name] ?? name);
    return !actual || [...required].some((kind) => !actual.has(kind));
  });
  if (missingTargetExports.length > 0) {
    migrationErrors.push(
      `${entry.source} target ${entry.target} is missing exports: ${missingTargetExports.sort().join(", ")}`,
    );
  }
}

const packagePublicSymbols = exportedSymbols(join(packageRoot, "src/index.ts"));
const forbiddenPublicExports = [
  "CheckboxInput",
  "CheckboxCardInput",
  "MultiSelect",
  "SelectInput",
  "SwitchInput",
  "RemoveBtn",
  "RemoveBtnProps",
  "SegmentedControlOption",
];
const requiredPublicExports: Array<[string, ExportKind]> = [
  ["Button", "value"],
  ["IconButton", "value"],
  ["Checkbox", "value"],
  ["CheckboxCard", "value"],
  ["MultiSelectInput", "value"],
  ["Select", "value"],
  ["Switch", "value"],
  ["RemoveButton", "value"],
  ["DateContext", "type"],
  ["DatePickerBaseProps", "type"],
  ["MaybeAccessor", "type"],
  ["SelectSourceOption", "type"],
  ["ContextMenuContent", "type"],
  ["CopyButtonValue", "type"],
  ["DropdownActionBase", "type"],
  ["PromptFieldBase", "type"],
  ["FilterChipChange", "type"],
  ["SegmentedControlChange", "type"],
];
for (const name of forbiddenPublicExports) {
  if (packagePublicSymbols.has(name)) {
    migrationErrors.push(`@k2b/ui must not expose the Cloud compatibility alias ${name}`);
  }
}
for (const [name, kind] of requiredPublicExports) {
  if (!packagePublicSymbols.get(name)?.has(kind)) {
    migrationErrors.push(`@k2b/ui must expose ${kind} export ${name}`);
  }
}

if (migrationErrors.length > 0) {
  console.error(`Incomplete implemented migrations:\n- ${migrationErrors.join("\n- ")}`);
  process.exit(1);
}

for (const additional of inventory.additionalSources ?? []) {
  const file = resolve(repositoryRoot, additional.source);
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
const baselineErrors = [
  ...(exportCount < MINIMUM_PUBLIC_EXPORTS
    ? [`public export count fell below ${MINIMUM_PUBLIC_EXPORTS}: ${exportCount}`]
    : []),
  ...(publicModules.size < MINIMUM_PUBLIC_MODULES
    ? [`public module count fell below ${MINIMUM_PUBLIC_MODULES}: ${publicModules.size}`]
    : []),
  ...(additionalExportCount < MINIMUM_ADDITIONAL_EXPORTS
    ? [`additional export count fell below ${MINIMUM_ADDITIONAL_EXPORTS}: ${additionalExportCount}`]
    : []),
];
if (baselineErrors.length > 0) {
  console.error(`Migration baseline regressed:\n- ${baselineErrors.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `Migration inventory covers ${exportCount} public exports from ${publicModules.size} UI modules and ${additionalExportCount} exports from ${
    inventory.additionalSources?.length ?? 0
  } additional source(s).`,
);
