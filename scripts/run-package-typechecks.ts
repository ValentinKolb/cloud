/**
 * Walk the configured workspace packages and run `bun run typecheck` in each
 * package. This intentionally ignores packages that live under `packages/` but
 * are not part of the release workspace.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dir, "..");
const rootPackage = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as { workspaces: string[] };

const packages = rootPackage.workspaces.toSorted().map((workspace) => {
  const pkg = JSON.parse(readFileSync(join(workspaceRoot, workspace, "package.json"), "utf8"));
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
