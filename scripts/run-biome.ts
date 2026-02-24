import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = join(import.meta.dir, "..");
const biomeBin = join(workspaceRoot, "node_modules", ".bin", "biome");

if (!existsSync(biomeBin)) {
  console.error("Missing Biome binary at node_modules/.bin/biome. Run 'bun install' first.");
  process.exit(1);
}

const mode = Bun.argv[2];
if (!mode) {
  console.error("Usage: bun run scripts/run-biome.ts <format|format:check|lint|lint:fix|check:biome>");
  process.exit(1);
}

const collectFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "build" || entry === "_ssr") continue;

    const filePath = join(dir, entry);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      collectFiles(filePath, out);
      continue;
    }

    if (!/\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(filePath)) continue;
    out.push(filePath);
  }

  return out;
};

const targets = [
  ...collectFiles(join(workspaceRoot, "packages")),
  ...collectFiles(join(workspaceRoot, "scripts")),
  join(workspaceRoot, "biome.json"),
  join(workspaceRoot, "package.json"),
].filter((file) => existsSync(file));

if (targets.length === 0) {
  console.error("No files matched Biome target set.");
  process.exit(1);
}

const commandArgsByMode: Record<string, string[]> = {
  format: ["format", "--write"],
  "format:check": ["format"],
  lint: ["lint"],
  "lint:fix": ["lint", "--write"],
  "check:biome": ["lint", "--diagnostic-level=error"],
};

const biomeArgs = commandArgsByMode[mode];
if (!biomeArgs) {
  console.error(`Unknown mode '${mode}'.`);
  process.exit(1);
}

const chunkSize = 200;
for (let i = 0; i < targets.length; i += chunkSize) {
  const chunk = targets.slice(i, i + chunkSize);
  const proc = Bun.spawn([biomeBin, ...biomeArgs, ...chunk], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) process.exit(exitCode);
}

