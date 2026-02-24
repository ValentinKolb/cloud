import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import ts from "typescript";

type PackageConfig = {
  name: string;
  srcRoot: string;
  aliasPrefix: string;
};

const workspaceRoot = join(import.meta.dir, "..");

const includeApps = process.env.CHECK_APPS_CYCLES === "1" || process.env.CHECK_APPS_CYCLES === "true";

const packages: PackageConfig[] = [
  {
    name: "cloud-contracts",
    srcRoot: join(workspaceRoot, "packages", "contracts", "src"),
    aliasPrefix: "@/",
  },
  {
    name: "cloud-lib",
    srcRoot: join(workspaceRoot, "packages", "lib", "src"),
    aliasPrefix: "@/",
  },
  {
    name: "cloud-core",
    srcRoot: join(workspaceRoot, "packages", "core", "src"),
    aliasPrefix: "@/",
  },
  ...(includeApps
    ? [
        {
          name: "cloud-apps",
          srcRoot: join(workspaceRoot, "packages", "apps", "src"),
          aliasPrefix: "@/",
        },
      ]
    : []),
];

const sourceFiles = (root: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      sourceFiles(path, out);
      continue;
    }
    if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
};

const extractRuntimeSpecifiers = (filePath: string, source: string): string[] => {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);

  const specifiers: string[] = [];

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      if (stmt.importClause?.isTypeOnly) continue;
      const spec = stmt.moduleSpecifier;
      if (ts.isStringLiteral(spec)) specifiers.push(spec.text);
      continue;
    }

    if (ts.isExportDeclaration(stmt)) {
      if (stmt.isTypeOnly) continue;
      const spec = stmt.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) specifiers.push(spec.text);
      continue;
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) specifiers.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return specifiers;
};

const tryResolveFile = (baseNoExt: string): string | null => {
  const candidates = [
    baseNoExt,
    `${baseNoExt}.ts`,
    `${baseNoExt}.tsx`,
    `${baseNoExt}.d.ts`,
    join(baseNoExt, "index.ts"),
    join(baseNoExt, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return normalize(candidate);
    }
  }

  return null;
};

const resolveLocalImport = (pkg: PackageConfig, fromFile: string, specifier: string): string | null => {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return tryResolveFile(resolve(dirname(fromFile), specifier));
  }

  if (specifier.startsWith(pkg.aliasPrefix)) {
    const withoutAlias = specifier.slice(pkg.aliasPrefix.length);
    return tryResolveFile(resolve(pkg.srcRoot, withoutAlias));
  }

  return null;
};

const buildGraph = (pkg: PackageConfig): Map<string, Set<string>> => {
  const graph = new Map<string, Set<string>>();
  const files = sourceFiles(pkg.srcRoot);

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const deps = new Set<string>();

    for (const specifier of extractRuntimeSpecifiers(file, source)) {
      const resolved = resolveLocalImport(pkg, file, specifier);
      if (!resolved) continue;
      if (!resolved.startsWith(pkg.srcRoot)) continue;
      deps.add(resolved);
    }

    graph.set(normalize(file), deps);
  }

  return graph;
};

const detectCycles = (graph: Map<string, Set<string>>): string[][] => {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  const dfs = (node: string) => {
    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const dep of graph.get(node) ?? []) {
      if (!graph.has(dep)) continue;

      if (!visited.has(dep)) {
        dfs(dep);
        continue;
      }

      if (stack.has(dep)) {
        const start = path.indexOf(dep);
        if (start !== -1) {
          cycles.push([...path.slice(start), dep]);
        }
      }
    }

    path.pop();
    stack.delete(node);
  };

  for (const node of graph.keys()) {
    if (!visited.has(node)) dfs(node);
  }

  const dedup = new Map<string, string[]>();
  for (const cycle of cycles) {
    const key = cycle.join(" -> ");
    if (!dedup.has(key)) dedup.set(key, cycle);
  }

  return [...dedup.values()];
};

let foundCycle = false;

for (const pkg of packages) {
  const graph = buildGraph(pkg);
  const cycles = detectCycles(graph);
  if (cycles.length === 0) continue;

  foundCycle = true;
  console.error(`Cycle check failed in ${pkg.name}:`);
  for (const cycle of cycles.slice(0, 20)) {
    const pretty = cycle.map((node) => relative(workspaceRoot, node)).join(" -> ");
    console.error(`- ${pretty}`);
  }
}

if (foundCycle) process.exit(1);

console.log(
  includeApps
    ? "Cycle check passed for cloud-contracts, cloud-lib, cloud-core, and cloud-apps."
    : "Cycle check passed for cloud-contracts, cloud-lib, and cloud-core.",
);
