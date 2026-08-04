import { readFileSync } from "node:fs";
import { join } from "node:path";

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  workspaces?: string[];
};

export type TestSuite = {
  name: string;
  cwd: string;
  command: string[];
};

const ignoredTestPaths = ["node_modules/", "dist/", "build/", "_ssr/"];
const testFiles = new Bun.Glob("**/*.{test,spec}.{ts,tsx,js,jsx}");

const readPackageJson = (path: string): PackageJson => JSON.parse(readFileSync(path, "utf8")) as PackageJson;

const hasTestFiles = async (cwd: string): Promise<boolean> => {
  for await (const path of testFiles.scan({ cwd, onlyFiles: true })) {
    if (!ignoredTestPaths.some((prefix) => path.startsWith(prefix))) return true;
  }
  return false;
};

export const discoverTestSuites = async (workspaceRoot: string): Promise<TestSuite[]> => {
  const rootPackage = readPackageJson(join(workspaceRoot, "package.json"));
  const workspaces = rootPackage.workspaces ?? [];
  const suites: TestSuite[] = [];

  for (const workspace of workspaces.toSorted()) {
    const cwd = join(workspaceRoot, workspace);
    const pkg = readPackageJson(join(cwd, "package.json"));
    if (pkg.scripts?.test) {
      suites.push({ name: pkg.name ?? workspace, cwd, command: ["bun", "run", "test"] });
    } else if (await hasTestFiles(cwd)) {
      suites.push({ name: pkg.name ?? workspace, cwd, command: ["bun", "test"] });
    }
  }

  suites.push(
    { name: "workspace root tests", cwd: join(workspaceRoot, "tests"), command: ["bun", "test"] },
    { name: "workspace root scripts", cwd: join(workspaceRoot, "scripts"), command: ["bun", "test"] },
  );

  return suites;
};

const run = async (): Promise<void> => {
  const workspaceRoot = join(import.meta.dir, "..");
  const suites = await discoverTestSuites(workspaceRoot);
  const failed: string[] = [];

  for (const suite of suites) {
    console.log(`\n=== ${suite.name} ===`);
    const process = Bun.spawn(suite.command, {
      cwd: suite.cwd,
      env: Bun.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await process.exited) !== 0) failed.push(suite.name);
  }

  if (failed.length > 0) {
    console.error(`\nFailed test suites (${failed.length}): ${failed.join(", ")}`);
    process.exit(1);
  }

  console.log(`\nAll ${suites.length} test suites passed.`);
};

if (import.meta.main) await run();
