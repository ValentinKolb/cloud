import type { StatusTone } from "@valentinkolb/cloud/ui";

export type OverviewSignalSeverity = "critical" | "warning" | "unavailable";

type OverviewSignal = {
  id: string;
  severity: OverviewSignalSeverity;
  icon: string;
  title: string;
  detail: string;
  href: string;
};

type OverviewVerdict = {
  tone: StatusTone;
  label: string;
  description: string;
};

export type OverviewSignalInput = {
  range: string;
  jobsWindow: string;
  offlineApps: string[];
  serverErrors: number;
  rateLimited: number;
  failedRuns: number;
  stuckRuns: number;
  logErrors: number;
  unavailable: Partial<Record<"apps" | "telemetry" | "runs" | "logs", string>>;
};

const formatCount = (value: number, singular: string, plural = `${singular}s`): string =>
  `${value.toLocaleString()} ${value === 1 ? singular : plural}`;

const summarizeApps = (apps: string[]): string => {
  const visible = apps.slice(0, 4);
  const remaining = apps.length - visible.length;
  return remaining > 0 ? `${visible.join(", ")} and ${remaining.toLocaleString()} more` : visible.join(", ");
};

/** Turn independent aggregates into a short, priority-ordered operator queue. */
export const buildOverviewSignals = (input: OverviewSignalInput): OverviewSignal[] => {
  const signals: OverviewSignal[] = [];

  if (input.offlineApps.length > 0) {
    signals.push({
      id: "offline-apps",
      severity: "critical",
      icon: "ti ti-plug-connected-x",
      title: `${formatCount(input.offlineApps.length, "app")} offline`,
      detail: summarizeApps(input.offlineApps),
      href: "/admin/gateway/apps",
    });
  }
  if (input.serverErrors > 0) {
    signals.push({
      id: "server-errors",
      severity: "critical",
      icon: "ti ti-alert-circle",
      title: formatCount(input.serverErrors, "server error"),
      detail: `HTTP 5xx responses in the last ${input.range}`,
      href: `/admin/observability/telemetry?range=${input.range}&errors=1`,
    });
  }
  if (input.stuckRuns > 0) {
    signals.push({
      id: "stuck-runs",
      severity: "critical",
      icon: "ti ti-clock-exclamation",
      title: `${formatCount(input.stuckRuns, "run")} stuck`,
      detail: `Open beyond the abandonment threshold`,
      href: `/admin/observability/jobs?window=${input.jobsWindow}&health=stuck`,
    });
  }

  const unavailableSignals = [
    ["apps", "App health unavailable", "/admin/gateway/apps"],
    ["telemetry", "Traffic signals unavailable", `/admin/observability/telemetry?range=${input.range}`],
    ["runs", "Run signals unavailable", `/admin/observability/jobs?window=${input.jobsWindow}`],
    ["logs", "Log signals unavailable", "/admin/observability/logs"],
  ] as const;
  for (const [source, title, href] of unavailableSignals) {
    const detail = input.unavailable[source];
    if (!detail) continue;
    signals.push({
      id: `unavailable-${source}`,
      severity: "unavailable",
      icon: "ti ti-database-off",
      title,
      detail,
      href,
    });
  }

  if (input.failedRuns > 0) {
    signals.push({
      id: "failed-runs",
      severity: "warning",
      icon: "ti ti-x",
      title: `${formatCount(input.failedRuns, "run")} failed`,
      detail: `Completed with an error in the last ${input.jobsWindow}`,
      href: `/admin/observability/jobs?window=${input.jobsWindow}&health=failed`,
    });
  }
  if (input.rateLimited > 0) {
    signals.push({
      id: "rate-limited",
      severity: "warning",
      icon: "ti ti-hand-stop",
      title: `${formatCount(input.rateLimited, "request")} rate limited`,
      detail: `HTTP 429 responses in the last ${input.range}`,
      href: `/admin/observability/telemetry?range=${input.range}`,
    });
  }
  if (input.logErrors > 0) {
    signals.push({
      id: "log-errors",
      severity: "warning",
      icon: "ti ti-file-alert",
      title: `${formatCount(input.logErrors, "error")} logged`,
      detail: "Across retained structured logs in the last 24h",
      href: "/admin/observability/logs?level=error",
    });
  }

  return signals;
};

export const overviewVerdict = (signals: OverviewSignal[]): OverviewVerdict => {
  const critical = signals.filter((signal) => signal.severity === "critical").length;
  const unavailable = signals.filter((signal) => signal.severity === "unavailable").length;
  const warning = signals.filter((signal) => signal.severity === "warning").length;

  if (critical > 0) {
    return {
      tone: "error",
      label: "Needs attention",
      description: `${formatCount(critical, "critical signal")} detected${unavailable > 0 ? ` · ${formatCount(unavailable, "source")} unavailable` : ""}.`,
    };
  }
  if (unavailable > 0) {
    return {
      tone: "degraded",
      label: "Visibility degraded",
      description: `${formatCount(unavailable, "signal source")} could not be read.`,
    };
  }
  if (warning > 0) {
    return {
      tone: "warn",
      label: "Review signals",
      description: `${formatCount(warning, "signal")} may need investigation.`,
    };
  }
  return {
    tone: "ok",
    label: "No active incidents",
    description: "Apps are online and no critical traffic or background-run signal is active.",
  };
};
