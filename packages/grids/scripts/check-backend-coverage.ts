const CRITICAL_DIRECTORIES = ["api/", "query-dsl/", "service/", "templates/"];
const CRITICAL_FILES = new Set(["config.ts", "contracts.ts", "migrate.ts", "ws.ts"]);

export type CoverageTotals = {
  functions: { found: number; hit: number };
  lines: { found: number; hit: number };
};

const emptyTotals = (): CoverageTotals => ({
  functions: { found: 0, hit: 0 },
  lines: { found: 0, hit: 0 },
});

export const isCriticalBackendSource = (sourcePath: string): boolean => {
  const normalized = sourcePath.replaceAll("\\", "/");
  const marker = "/packages/grids/src/";
  const markerIndex = normalized.lastIndexOf(marker);
  const relative = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized.replace(/^.*?src\//, "");
  if (relative.endsWith(".test.ts") || relative.endsWith(".integration.test.ts")) return false;
  return CRITICAL_FILES.has(relative) || CRITICAL_DIRECTORIES.some((directory) => relative.startsWith(directory));
};

export const parseBackendCoverage = (lcov: string): CoverageTotals => {
  const totals = emptyTotals();
  for (const record of lcov.split("end_of_record")) {
    const values = new Map(
      record
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf(":");
          return separator < 0 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
    const source = values.get("SF");
    if (!source || !isCriticalBackendSource(source)) continue;
    totals.lines.found += Number(values.get("LF") ?? 0);
    totals.lines.hit += Number(values.get("LH") ?? 0);
    totals.functions.found += Number(values.get("FNF") ?? 0);
    totals.functions.hit += Number(values.get("FNH") ?? 0);
  }
  return totals;
};

export const coveragePercent = ({ found, hit }: { found: number; hit: number }): number => (found === 0 ? 100 : (hit / found) * 100);

const MINIMUM_LINES = 80;
const MINIMUM_FUNCTIONS = 80;

if (import.meta.main) {
  const path = process.argv[2] ?? "coverage/lcov.info";
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Coverage report not found: ${path}`);

  const totals = parseBackendCoverage(await file.text());
  if (totals.lines.found === 0 || totals.functions.found === 0) {
    throw new Error("Coverage report contains no critical Grids backend modules");
  }
  const lines = coveragePercent(totals.lines);
  const functions = coveragePercent(totals.functions);
  console.log(`Critical Grids backend coverage: ${lines.toFixed(2)}% lines, ${functions.toFixed(2)}% functions`);

  const failures = [
    ...(lines < MINIMUM_LINES ? [`lines ${lines.toFixed(2)}% < ${MINIMUM_LINES}%`] : []),
    ...(functions < MINIMUM_FUNCTIONS ? [`functions ${functions.toFixed(2)}% < ${MINIMUM_FUNCTIONS}%`] : []),
  ];
  if (failures.length > 0) throw new Error(`Backend coverage regression: ${failures.join(", ")}`);
}
