/**
 * Walk the workspace and run `bun run typecheck` in every package that
 * declares one. Beats hardcoding the package list — adding a new app no
 * longer requires touching this file.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dir, "..");
const packagesRoot = join(workspaceRoot, "packages");

const packages = readdirSync(packagesRoot)
  .filter((name) => existsSync(join(packagesRoot, name, "package.json")))
  .sort()
  .map((name) => {
    const pkg = JSON.parse(readFileSync(join(packagesRoot, name, "package.json"), "utf8"));
    return pkg.name as string;
  });

for (const pkg of packages) {
  const proc = Bun.spawn(["bun", "run", "--filter", pkg, "typecheck"], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) process.exit(exitCode);
}
