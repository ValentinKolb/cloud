import { resolve } from "node:path";

export const packageSpecifier = (packageName: string, exportPath: string) =>
  exportPath === "." ? packageName : `${packageName}${exportPath.slice(1)}`;

export const undocumentedExports = (packageName: string, exports: Record<string, unknown>, reference: string): string[] =>
  Object.keys(exports)
    .map((exportPath) => packageSpecifier(packageName, exportPath))
    .filter((specifier) => !reference.includes(`\`${specifier}\``));

if (import.meta.main) {
  const workspaceRoot = resolve(import.meta.dir, "../..");
  const packageJson = await Bun.file(resolve(workspaceRoot, "packages/cloud/package.json")).json();
  const referenceRoot = resolve(workspaceRoot, "docs-site/docs/en/reference");
  const reference = await Bun.file(resolve(referenceRoot, "api-surface.md")).text();
  const missing = undocumentedExports(packageJson.name, packageJson.exports, reference);

  if (missing.length > 0) {
    console.error(`Cloud package exports missing from the API reference:\n${missing.map((specifier) => `- ${specifier}`).join("\n")}`);
    process.exit(1);
  }

  console.log(`API surface check passed (${Object.keys(packageJson.exports).length} exports classified).`);
}
