#!/usr/bin/env bun
/**
 * dev:status [app] — inventory of dev-stack apps + their state.
 *
 *   bun run dev:status            — table of every app declared in compose
 *   bun run dev:status <app>      — detail block + last 20 log lines for one app
 *
 * Output is plain text by design: pretty for humans, scannable for an
 * LLM agent (stable section labels, fixed state-enum strings, compact
 * time format). ANSI colors only on TTY — piped output stays clean.
 *
 * State column values are a closed set: `running` / `stopped` / `never built`.
 * The agent-facing skill docs match these strings literally; don't rename
 * them without updating those.
 */
import { $ } from "bun";
import {
  color,
  compose,
  formatRelative,
  formatUptimeFromStatus,
  helpFor,
  listDevServices,
  resolveApps,
  shortName,
} from "./dev-cli";

type ComposeRow = {
  Name: string;
  Service: string;
  State: string;
  Status: string;
  Health: string;
  Image: string;
};

/** Bulk-fetch image creation timestamps for every cloud-* image. One
 *  docker call → one map lookup per service, instead of N inspect calls.
 *  Filter is `cloud-*` (not `cloud-app-*`) so the gateway image
 *  (`cloud-gateway`) is included alongside `cloud-app-*`. Missing image
 *  (never built) → undefined → renders as "—". */
const fetchImageAges = async (): Promise<Map<string, Date>> => {
  const raw = await $`docker images --filter ${"reference=cloud-*"} --format ${"{{.Repository}}\t{{.CreatedAt}}"}`
    .text()
    .catch(() => "");
  const out = new Map<string, Date>();
  for (const line of raw.trim().split("\n").filter(Boolean)) {
    const [repo, ...rest] = line.split("\t");
    if (!repo) continue;
    // CreatedAt format: "2026-05-12 13:08:36 +0200 CEST" — Date parses the
    // leading 19 chars + offset reliably; trailing zone abbreviation is
    // redundant and varies by locale.
    const stamp = rest.join("\t").replace(/\s+\w+$/, "");
    const date = new Date(stamp);
    if (!Number.isNaN(date.getTime())) out.set(repo, date);
  }
  return out;
};

const fetchComposePs = async (): Promise<Map<string, ComposeRow>> => {
  const raw = await compose(["ps", "--all", "--format", "{{json .}}"]).text();
  const out = new Map<string, ComposeRow>();
  for (const line of raw.trim().split("\n").filter(Boolean)) {
    try {
      const row = JSON.parse(line) as ComposeRow;
      out.set(row.Service, row);
    } catch {
      // Skip malformed rows — non-fatal.
    }
  }
  return out;
};

type AppState = "running" | "stopped" | "never built";

type AppStatus = {
  short: string;
  service: string;
  state: AppState;
  uptime: string;
  health: string;
  imageAge: string;
  row: ComposeRow | undefined;
};

const buildStatuses = async (services: string[]): Promise<AppStatus[]> => {
  const [psMap, imageAges] = await Promise.all([fetchComposePs(), fetchImageAges()]);
  return services.map((service) => {
    const row = psMap.get(service);
    const imageRepo = `cloud-${service}`;
    const builtAt = imageAges.get(imageRepo) ?? null;
    let state: AppState;
    if (row?.State === "running") state = "running";
    else if (row) state = "stopped";
    else if (!builtAt) state = "never built";
    else state = "stopped";
    const uptime = row?.State === "running" ? formatUptimeFromStatus(row.Status) : "—";
    const health = row?.Health || "—";
    return {
      short: shortName(service),
      service,
      state,
      uptime,
      health,
      imageAge: formatRelative(builtAt),
      row,
    };
  });
};

// =============================================================================
// Table view (no arg)
// =============================================================================

const stateColor = (s: AppState): string => {
  if (s === "running") return color.green;
  if (s === "stopped") return color.yellow;
  return color.dim;
};

const padRight = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

const printTable = (rows: AppStatus[]) => {
  const headers = ["App", "State", "Uptime", "Health", "Image age"];
  const widths = [
    Math.max(headers[0]!.length, ...rows.map((r) => r.short.length)) + 2,
    Math.max(headers[1]!.length, ...rows.map((r) => r.state.length)) + 2,
    Math.max(headers[2]!.length, ...rows.map((r) => r.uptime.length)) + 2,
    Math.max(headers[3]!.length, ...rows.map((r) => r.health.length)) + 2,
    Math.max(headers[4]!.length, ...rows.map((r) => r.imageAge.length)),
  ];
  // Header row
  console.log(
    color.bold +
      headers.map((h, i) => padRight(h, widths[i]!)).join("") +
      color.reset,
  );
  // Data rows — only state cell gets a color; rest stays plain so the
  // overall output reads cleanly when capture-piped.
  for (const r of rows) {
    const c = stateColor(r.state);
    const stateCell = `${c}${r.state}${color.reset}`;
    const stateVisibleLen = r.state.length;
    const statePadded = stateCell + " ".repeat(Math.max(0, widths[1]! - stateVisibleLen));
    console.log(
      padRight(r.short, widths[0]!) +
        statePadded +
        padRight(r.uptime, widths[2]!) +
        padRight(r.health, widths[3]!) +
        r.imageAge,
    );
  }
};

const printSummary = (rows: AppStatus[]) => {
  const running = rows.filter((r) => r.state === "running").length;
  const stopped = rows.filter((r) => r.state === "stopped").length;
  const never = rows.filter((r) => r.state === "never built").length;
  console.log(`${color.dim}${rows.length} apps · ${running} running · ${stopped} stopped · ${never} never built${color.reset}`);
};

// =============================================================================
// Detail view (single app)
// =============================================================================

const printDetail = async (s: AppStatus) => {
  console.log(`${color.bold}Name${color.reset}       ${s.short}`);
  console.log(`Service    ${s.service}`);
  const stateLine = `${stateColor(s.state)}${s.state}${color.reset}`;
  console.log(`State      ${stateLine}`);
  if (s.row) {
    console.log(`Container  ${s.row.Name}`);
    console.log(`Image      ${s.row.Image}`);
    console.log(`Status     ${s.row.Status}`);
    if (s.row.Health) console.log(`Health     ${s.row.Health}`);
  }
  console.log(`Image age  ${s.imageAge}`);

  if (s.state === "running") {
    console.log("");
    console.log(`${color.bold}Recent logs (last 20 lines)${color.reset}`);
    const logs = await compose(["logs", "--tail", "20", "--no-color", s.service]).text();
    // `compose logs` prefixes each line with the container name + spaces —
    // strip the prefix for compactness; the detail header already tells
    // the user which service these logs belong to.
    for (const line of logs.split("\n")) {
      if (!line.trim()) continue;
      const stripped = line.replace(/^\S+\s+\|\s?/, "");
      console.log(`  ${stripped}`);
    }
  }
};

// =============================================================================
// Entrypoint
// =============================================================================

const inputs = process.argv.slice(2);

if (inputs[0] === "--help" || inputs[0] === "-h") {
  helpFor("bun run dev:status [app]", [
    "Show inventory of all apps, or detailed info for one.",
    "",
    "Examples:",
    "  bun run dev:status              table of every app",
    "  bun run dev:status notebooks    detail + recent logs for one",
  ]);
  process.exit(0);
}

if (inputs.length === 0) {
  // Table view
  const services = await listDevServices();
  const rows = await buildStatuses(services);
  printTable(rows);
  console.log("");
  printSummary(rows);
} else if (inputs.length === 1) {
  // Detail view
  const [service] = await resolveApps(inputs);
  const [status] = await buildStatuses([service!]);
  await printDetail(status!);
} else {
  console.error("dev:status takes zero or one app argument.");
  console.error("Examples:");
  console.error("  bun run dev:status");
  console.error("  bun run dev:status notebooks");
  process.exit(1);
}
