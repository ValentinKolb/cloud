import type { PanelVisual, PulseDashboard, PulseDashboardConfig, PulseDashboardDslCompileResult, PulseExplorerQuery } from "../../contracts";

export const quoteDashboardDslString = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const dashboardVisualStatement = (visual: PanelVisual): string => visual;

type QueryLineState = {
  output: string;
  pendingSpace: boolean;
};

const isQuote = (char: string): char is '"' | "'" => char === '"' || char === "'";

const appendQueryLineText = (state: QueryLineState, text: string): void => {
  if (state.pendingSpace && state.output) state.output += " ";
  state.pendingSpace = false;
  state.output += text;
};

const readQuotedQuerySegment = (query: string, startIndex: number, quote: '"' | "'"): { text: string; endIndex: number } => {
  let text = quote;
  for (let index = startIndex + 1; index < query.length; index += 1) {
    const char = query[index]!;
    text += char;
    if (char === "\\" && index + 1 < query.length) {
      index += 1;
      text += query[index]!;
    } else if (char === quote) {
      return { text, endIndex: index };
    }
  }
  return { text, endIndex: query.length - 1 };
};

export const dashboardQueryLine = (query: string): string => {
  const state: QueryLineState = { output: "", pendingSpace: false };

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index]!;
    if (isQuote(char)) {
      const segment = readQuotedQuerySegment(query, index, char);
      appendQueryLineText(state, segment.text);
      index = segment.endIndex;
      continue;
    }

    if (/\s/.test(char)) {
      state.pendingSpace = true;
      continue;
    }

    appendQueryLineText(state, char);
  }

  return state.output.trim();
};

export const dashboardWidgetSnippetFromQuery = (query: string, compiled: PulseExplorerQuery, visual: PanelVisual): string => {
  const normalizedQuery = dashboardQueryLine(query);
  if (compiled.kind === "metric") {
    return `${dashboardVisualStatement(visual)} ${quoteDashboardDslString(compiled.metric)} {\n  query ${normalizedQuery}\n}`;
  }
  if (compiled.kind === "events") {
    return `table ${quoteDashboardDslString(compiled.event || "Events")} {\n  query ${normalizedQuery}\n}`;
  }
  return `table ${quoteDashboardDslString(compiled.state || "States")} {\n  query ${normalizedQuery}\n}`;
};

export const emptyDashboardDsl = (name: string, description?: string | null): string => {
  const lines = [`dashboard ${quoteDashboardDslString(name)} {`];
  const dashboardDescription = description?.trim();
  if (dashboardDescription) lines.push(`  description ${quoteDashboardDslString(dashboardDescription)}`);
  lines.push("}");
  return lines.join("\n");
};

export const dashboardToDsl = (dashboard: PulseDashboard): string => (dashboard.config.dsl?.trim() ? dashboard.config.dsl : "");

export const shouldSkipDashboardDslPreview = (baseId: string, text: string): boolean => !baseId || !text.trim();

export const dashboardDslPreviewIsCurrent = (input: {
  currentDashboardId: string | null | undefined;
  currentRequestId: number;
  currentText: string;
  dashboardId: string;
  requestId: number;
  text: string;
}): boolean =>
  input.requestId === input.currentRequestId && input.dashboardId === input.currentDashboardId && input.text === input.currentText;

export const dashboardPreviewConfigFromResult = (result: PulseDashboardDslCompileResult): PulseDashboardConfig | null =>
  result.ok && result.config ? result.config : null;
