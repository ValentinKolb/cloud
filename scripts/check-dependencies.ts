import { readFileSync } from "node:fs";
import { join } from "node:path";

type DependencySection = Record<string, string>;

type PackageJson = {
  name?: string;
  private?: boolean;
  workspaces?: {
    packages?: string[];
    catalog?: Record<string, string>;
  };
  dependencies?: DependencySection;
  devDependencies?: DependencySection;
  optionalDependencies?: DependencySection;
  peerDependencies?: DependencySection;
  trustedDependencies?: string[];
};

const workspaceRoot = join(import.meta.dir, "..");
const readPackage = (path: string): PackageJson => JSON.parse(readFileSync(path, "utf8")) as PackageJson;
const root = readPackage(join(workspaceRoot, "package.json"));
const catalog = root.workspaces?.catalog ?? {};
const violations: string[] = [];
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (root.private !== true) violations.push("package.json: workspace root must be private");
if (root.dependencies && Object.keys(root.dependencies).length > 0) {
  violations.push("package.json: root dependencies must not provide packages to workspaces through hoisting");
}
for (const [name, spec] of Object.entries(root.devDependencies ?? {})) {
  if (!exactVersion.test(spec)) violations.push(`package.json: devDependencies.${name} must use an exact version`);
}
if (!Array.isArray(root.trustedDependencies) || root.trustedDependencies.length !== 0) {
  violations.push("package.json: dependency lifecycle scripts must be denied by default");
}

for (const [name, version] of Object.entries(catalog)) {
  if (!exactVersion.test(version)) violations.push(`package.json: catalog entry ${name} must use an exact version`);
}

for (const workspace of root.workspaces?.packages ?? []) {
  const file = join(workspace, "package.json");
  const pkg = readPackage(join(workspaceRoot, file));
  const published = pkg.private !== true;

  for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      if (spec === "workspace:*") {
        if (published) violations.push(`${file}: published packages must contain concrete versions for ${section}.${name}`);
        continue;
      }
      if (!published && catalog[name]) {
        if (spec !== "catalog:") violations.push(`${file}: ${section}.${name} must use catalog:`);
        continue;
      }
      if (spec.startsWith("catalog:")) {
        violations.push(`${file}: published packages must contain concrete versions for ${section}.${name}`);
      } else if (!exactVersion.test(spec)) {
        violations.push(`${file}: ${section}.${name} must use an exact version`);
      }
    }
  }

  for (const [name, spec] of Object.entries(pkg.peerDependencies ?? {})) {
    if (spec.startsWith("catalog:")) violations.push(`${file}: peerDependencies.${name} must be a compatibility range`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log(`Dependency policy valid for ${root.workspaces?.packages?.length ?? 0} workspaces.`);
