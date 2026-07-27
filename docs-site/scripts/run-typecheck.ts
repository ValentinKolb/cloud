import { resolve } from "node:path";

type FilteredDiagnostics = {
  ignored: number;
  remaining: string;
};

const diagnosticHeader = /^(.*)\((\d+),(\d+)\): error TS(\d+):\s*(.*)$/;

const isKnownSsrDiagnostic = (lines: string[]): boolean => {
  const match = lines[0]?.match(diagnosticHeader);
  if (!match) return false;

  const [, file, line, column, code] = match;
  const normalizedFile = file.replaceAll("\\", "/");
  const knownFile = "node_modules/@valentinkolb/ssr/src/adapter/hono.ts";
  return (
    (normalizedFile === knownFile || normalizedFile.endsWith(`/${knownFile}`)) &&
    line === "179" &&
    column === "77" &&
    code === "2345" &&
    lines.join("\n").includes("Argument of type 'string | undefined' is not assignable to parameter of type 'string'.")
  );
};

export const filterKnownDiagnostics = (output: string): FilteredDiagnostics => {
  const normalized = output.replaceAll("\r\n", "\n").trim();
  if (!normalized) return { ignored: 0, remaining: "" };

  const groups: string[][] = [];
  for (const line of normalized.split("\n")) {
    if (diagnosticHeader.test(line) || groups.length === 0) {
      groups.push([line]);
    } else {
      groups.at(-1)?.push(line);
    }
  }

  const remaining: string[][] = [];
  let ignored = 0;
  for (const group of groups) {
    if (isKnownSsrDiagnostic(group)) ignored += 1;
    else remaining.push(group);
  }

  return {
    ignored,
    remaining: remaining.map((group) => group.join("\n")).join("\n"),
  };
};

export const typecheckFailed = (exitCode: number, diagnostics: FilteredDiagnostics): boolean =>
  diagnostics.remaining.length > 0 || (exitCode !== 0 && diagnostics.ignored === 0);

if (import.meta.main) {
  const project = Bun.argv[2];
  if (!project) {
    console.error("Usage: bun run-typecheck.ts <tsconfig>");
    process.exit(2);
  }

  const siteRoot = resolve(import.meta.dir, "..");
  const tsc = resolve(siteRoot, "node_modules/typescript/bin/tsc");
  const child = Bun.spawn([Bun.which("bun") ?? "bun", tsc, "-p", project, "--pretty", "false"], {
    cwd: siteRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const filtered = filterKnownDiagnostics([stdout, stderr].filter(Boolean).join("\n"));

  if (filtered.remaining) {
    console.error(filtered.remaining);
    process.exit(exitCode || 1);
  }
  if (typecheckFailed(exitCode, filtered)) {
    console.error(`TypeScript exited with code ${exitCode} without a diagnostic.`);
    process.exit(exitCode || 1);
  }
  if (filtered.ignored > 0) {
    console.warn("Ignored the known @valentinkolb/ssr 0.11.0 adapter diagnostic at hono.ts:179:77.");
  }
}
