import type { Completion, SuggestContext, Suggestion } from "@valentinkolb/cloud/ui";
import { AGGREGATIONS } from "../contracts";
import type { PulseCurrentState, PulseMetricSeries, PulseMetricSummary, PulseRecordedEvent, PulseSource } from "../contracts";

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const quoteQueryValue = (value: string): string =>
  /[\s,=]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;

const previousToken = (text: string, tokenStart: number): string => {
  const before = text.slice(0, tokenStart).trimEnd();
  const parts = before.split(/\s+/);
  return parts.at(-1)?.toLowerCase() ?? "";
};

const tokensBefore = (text: string, tokenStart: number): string[] => text.slice(0, tokenStart).trim().split(/\s+/).filter(Boolean);

const hasWhere = (text: string): boolean => /\bwhere\b/i.test(text);

const matches = (value: string, query: string): boolean => value.toLowerCase().includes(query.trim().toLowerCase());

const suggestion = (text: string, hint?: string, expansion?: string): Suggestion => ({
  text,
  label: text,
  hint,
  expansion: expansion && expansion !== text ? expansion : undefined,
});

const statementSuggestions = (query: string): Suggestion[] =>
  [
    suggestion("metric", "metric time series"),
    suggestion("events", "event rows"),
    suggestion("states", "current states"),
  ].filter((item) => matches(item.text, query));

const metricNameSuggestions = (metrics: PulseMetricSummary[], query: string): Suggestion[] =>
  metrics
    .filter((metric) => matches(metric.name, query))
    .slice(0, 40)
    .map((metric) => suggestion(metric.name, [metric.type, metric.unit].filter(Boolean).join(" · "), quoteQueryValue(metric.name)));

const aggregationSuggestions = (query: string): Suggestion[] =>
  AGGREGATIONS.filter((item) => matches(item, query)).map((item) => suggestion(item, "aggregation"));

const clauseSuggestions = (kind: "metric" | "events" | "states", query: string, text: string): Suggestion[] => {
  const clauses =
    kind === "metric"
      ? ["every", "since", "source", ...(hasWhere(text) ? [] : ["where"])]
      : ["since", "source", "entity", "entity_type", "limit", ...(hasWhere(text) ? [] : ["where"])];
  return clauses.filter((item) => item.startsWith(query.toLowerCase())).map((item) => suggestion(item, "clause"));
};

const withTriggerPrefix = (trigger: string, items: Suggestion[]): Suggestion[] =>
  items.map((item) => ({
    ...item,
    text: `${trigger}${item.text}`,
    label: item.label ?? item.text,
    expansion: `${trigger}${item.expansion ?? item.text}`,
  }));

export const buildPulseQuery = (params: {
  metric: string;
  aggregation?: string;
  bucket?: string;
  since?: string;
  sourceId?: string | null;
  dimensions?: Record<string, string | number | boolean | null>;
}): string => {
  const filters = Object.entries(params.dimensions ?? {}).map(([key, value]) => `${key}=${quoteQueryValue(String(value))}`);
  return [
    "metric",
    quoteQueryValue(params.metric),
    params.aggregation ?? "avg",
    "every",
    params.bucket ?? "5m",
    "since",
    params.since ?? "24h",
    params.sourceId ? `source ${params.sourceId}` : "",
    filters.length > 0 ? `where ${filters.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
};

export const defaultPulseQuery = (metrics: PulseMetricSummary[]): string => {
  const metric = metrics[0];
  if (!metric) return "";
  const aggregation = metric.type === "counter" ? "rate" : metric.type === "histogram" || metric.type === "summary" ? "p95" : "avg";
  return buildPulseQuery({ metric: metric.name, aggregation, bucket: "5m", since: "24h" });
};

export const buildPulseQueryCompletions = (params: {
  metrics: PulseMetricSummary[];
  events?: PulseRecordedEvent[];
  states?: PulseCurrentState[];
  sources: PulseSource[];
  series: PulseMetricSeries[];
}): Completion[] => [
  {
    dropdown: true,
    suggest: (query: string, ctx: SuggestContext) => {
      const prev = previousToken(ctx.fullText, ctx.tokenStart);
      const before = tokensBefore(ctx.fullText, ctx.tokenStart);
      const first = before[0]?.toLowerCase() ?? "";
      const tokenIndex = before.length;
      if (prev === "metric") {
        return metricNameSuggestions(params.metrics, query);
      }
      if (prev === "events") {
        const kinds = [...new Set((params.events ?? []).map((event) => event.kind))];
        return ["*", ...kinds]
          .filter((kind) => matches(kind, query))
          .slice(0, 40)
          .map((kind) => suggestion(kind, kind === "*" ? "all events" : "event kind", quoteQueryValue(kind)));
      }
      if (prev === "states") {
        const keys = [...new Set((params.states ?? []).map((state) => state.key))];
        return ["*", ...keys]
          .filter((key) => matches(key, query))
          .slice(0, 40)
          .map((key) => suggestion(key, key === "*" ? "all states" : "state key", quoteQueryValue(key)));
      }
      if (prev === "source") {
        return params.sources
          .filter((source) => matches(source.name, query) || matches(source.id, query))
          .slice(0, 30)
          .map((source) => suggestion(source.name, `${source.kind} · ${source.id.slice(0, 8)}`, source.id));
      }
      if (prev === "every") return ["1m", "5m", "15m", "1h"].filter((value) => matches(value, query)).map((value) => suggestion(value, "bucket"));
      if (prev === "since") return ["1h", "6h", "24h", "7d", "30d"].filter((value) => matches(value, query)).map((value) => suggestion(value, "range"));
      if (prev === "limit") return ["50", "100", "500", "1000"].filter((value) => matches(value, query)).map((value) => suggestion(value, "rows"));
      if (prev === "entity") {
        const entities = [
          ...new Set([
            ...params.series.map((item) => item.entityId).filter((value): value is string => !!value),
            ...(params.events ?? []).map((item) => item.entityId).filter((value): value is string => !!value),
            ...(params.states ?? []).map((item) => item.entityId).filter((value): value is string => !!value),
          ]),
        ];
        return entities.filter((value) => matches(value, query)).slice(0, 40).map((value) => suggestion(value, "entity", quoteQueryValue(value)));
      }
      if (prev === "where" || ctx.fullText.slice(0, ctx.tokenStart).trimEnd().endsWith(",")) {
        const dimensions = new Map<string, Set<string>>();
        for (const item of params.series) {
          for (const [key, value] of Object.entries(item.dimensions)) {
            if (!dimensions.has(key)) dimensions.set(key, new Set());
            dimensions.get(key)!.add(value);
          }
        }
        for (const item of [...(params.events ?? []), ...(params.states ?? [])]) {
          for (const [key, value] of Object.entries(item.dimensions)) {
            if (!dimensions.has(key)) dimensions.set(key, new Set());
            dimensions.get(key)!.add(value);
          }
        }
        return [...dimensions.entries()]
          .filter(([key]) => matches(key, query))
          .slice(0, 40)
          .map(([key, values]) => {
            const value = [...values][0] ?? "";
            return suggestion(`${key}=`, `${values.size} values`, value ? `${key}=${quoteQueryValue(value)}` : `${key}=`);
          });
      }
      if (!first) return statementSuggestions(query);
      if (tokenIndex <= 1 && ["metric", "events", "states"].some((item) => item.startsWith(query.toLowerCase()))) return statementSuggestions(query);
      if (first === "metric") {
        if (tokenIndex === 1) return metricNameSuggestions(params.metrics, query);
        if (tokenIndex === 2) return aggregationSuggestions(query);
        return clauseSuggestions("metric", query, ctx.fullText);
      }
      if (first === "events") {
        if (tokenIndex === 1) {
          const kinds = [...new Set((params.events ?? []).map((event) => event.kind))];
          return ["*", ...kinds]
            .filter((kind) => matches(kind, query))
            .slice(0, 40)
            .map((kind) => suggestion(kind, kind === "*" ? "all events" : "event kind", quoteQueryValue(kind)));
        }
        return clauseSuggestions("events", query, ctx.fullText);
      }
      if (first === "states") {
        if (tokenIndex === 1) {
          const keys = [...new Set((params.states ?? []).map((state) => state.key))];
          return ["*", ...keys]
            .filter((key) => matches(key, query))
            .slice(0, 40)
            .map((key) => suggestion(key, key === "*" ? "all states" : "state key", quoteQueryValue(key)));
        }
        return clauseSuggestions("states", query, ctx.fullText);
      }
      return statementSuggestions(query);
    },
  },
  {
    trigger: " ",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query: string, ctx: SuggestContext, signal: AbortSignal) => {
      const result = buildPulseQueryCompletions(params)[0]!.suggest(query, ctx, signal);
      return Array.isArray(result) ? withTriggerPrefix(" ", result) : result.then((items) => withTriggerPrefix(" ", items));
    },
  },
];

export const pulseQueryHighlight = (text: string): string => {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      let end = i + 1;
      let escaped = false;
      while (end < text.length) {
        const current = text[end]!;
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === '"') {
          end += 1;
          break;
        }
        end += 1;
      }
      out += `<span class="text-amber-700 dark:text-amber-300">${escapeHtml(text.slice(i, end))}</span>`;
      i = end;
      continue;
    }
    if (/[A-Za-z0-9_.-]/.test(ch)) {
      let end = i + 1;
      while (end < text.length && /[A-Za-z0-9_.-]/.test(text[end]!)) end += 1;
      const token = text.slice(i, end);
      const lower = token.toLowerCase();
      if (
        lower === "metric" ||
        lower === "events" ||
        lower === "states" ||
        lower === "every" ||
        lower === "since" ||
        lower === "source" ||
        lower === "entity" ||
        lower === "entity_type" ||
        lower === "limit" ||
        lower === "where"
      ) {
        out += `<span class="text-blue-600 dark:text-blue-300">${escapeHtml(token)}</span>`;
      } else if (AGGREGATIONS.includes(lower as (typeof AGGREGATIONS)[number])) {
        out += `<span class="text-emerald-700 dark:text-emerald-300">${escapeHtml(token)}</span>`;
      } else if (/^\d+[mhd]$/.test(lower)) {
        out += `<span class="text-purple-700 dark:text-purple-300">${escapeHtml(token)}</span>`;
      } else {
        out += escapeHtml(token);
      }
      i = end;
      continue;
    }
    out += escapeHtml(ch);
    i += 1;
  }
  return out;
};

const DASHBOARD_DSL_KEYWORDS = new Set([
  "dashboard",
  "description",
  "controls",
  "range",
  "text",
  "source",
  "entity",
  "section",
  "row",
  "card",
  "stat",
  "gauge",
  "line",
  "bar",
  "barGauge",
  "table",
  "markdown",
  "query",
  "warn",
  "critical",
  "when",
  "message",
]);

const DASHBOARD_QUERY_KEYWORDS = new Set(["metric", "events", "states", "every", "since", "where", "limit", "entity_type"]);

export const pulseDashboardDslHighlight = (text: string): string => {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      const finish = end === -1 ? text.length : end + 3;
      out += `<span class="text-amber-700 dark:text-amber-300">${escapeHtml(text.slice(i, finish))}</span>`;
      i = finish;
      continue;
    }

    const ch = text[i]!;
    if (ch === '"') {
      let end = i + 1;
      let escaped = false;
      while (end < text.length) {
        const current = text[end]!;
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === '"') {
          end += 1;
          break;
        }
        end += 1;
      }
      out += `<span class="text-amber-700 dark:text-amber-300">${escapeHtml(text.slice(i, end))}</span>`;
      i = end;
      continue;
    }

    if (/[A-Za-z0-9_.$-]/.test(ch)) {
      let end = i + 1;
      while (end < text.length && /[A-Za-z0-9_.$-]/.test(text[end]!)) end += 1;
      const token = text.slice(i, end);
      const lower = token.toLowerCase();
      if (DASHBOARD_DSL_KEYWORDS.has(token) || DASHBOARD_QUERY_KEYWORDS.has(lower)) {
        out += `<span class="text-blue-600 dark:text-blue-300">${escapeHtml(token)}</span>`;
      } else if (AGGREGATIONS.includes(lower as (typeof AGGREGATIONS)[number]) || lower === "latest" || lower === "increase") {
        out += `<span class="text-emerald-700 dark:text-emerald-300">${escapeHtml(token)}</span>`;
      } else if (/^\$?[0-9]+[mhd]?$/.test(lower) || lower.startsWith("$")) {
        out += `<span class="text-purple-700 dark:text-purple-300">${escapeHtml(token)}</span>`;
      } else {
        out += escapeHtml(token);
      }
      i = end;
      continue;
    }

    out += escapeHtml(ch);
    i += 1;
  }
  return out;
};
