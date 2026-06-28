import type {
  EventQuery,
  MetricQuery,
  PulseDashboardCondition,
  PulseDashboardConfig,
  PulseDashboardControl,
  PulseDashboardEventQuery,
  PulseDashboardEventsWidget,
  PulseDashboardLayout,
  PulseDashboardMarkdownWidget,
  PulseDashboardMetricQuery,
  PulseDashboardMetricWidget,
  PulseDashboardRow,
  PulseDashboardSection,
  PulseDashboardStateQuery,
  PulseDashboardStatesWidget,
  PulseDashboardWidget,
  PulseExplorerQuery,
  StateQuery,
} from "../contracts";

export type DashboardDslDiagnostic = {
  severity: "error";
  message: string;
  line: number;
  column: number;
};

type Result<T> = { ok: true; data: T; diagnostics: DashboardDslDiagnostic[] } | { ok: false; diagnostics: DashboardDslDiagnostic[] };

export type DashboardDslDocument = {
  kind: "dashboard";
  title: string;
  description: string | null;
  controls: DashboardDslControl[];
  blocks: DashboardDslBlock[];
};

type DashboardDslBlock = DashboardDslSection | DashboardDslCard | DashboardDslMarkdown | DashboardDslVisual | DashboardDslRow;

type DashboardDslControl = {
  kind: PulseDashboardControl["kind"];
  label: string;
  variable: string;
  defaultValue: string;
  options: string[];
  entityType: string | null;
};

type DashboardDslSection = {
  kind: "section";
  title: string;
  description: string | null;
  blocks: DashboardDslBlock[];
};

type DashboardDslCard = {
  kind: "card";
  title: string;
  description: string | null;
  span: number | null;
  blocks: DashboardDslBlock[];
};

type DashboardDslRow = {
  kind: "row";
  height: PulseDashboardRow["height"];
  blocks: DashboardDslBlock[];
};

type DashboardDslMarkdown = {
  kind: "markdown";
  title: string | null;
  description: string | null;
  markdown: string;
  span: number | null;
};

type DashboardDslVisual = {
  kind: "visual";
  title: string;
  visual: PulseDashboardMetricWidget["visual"] | PulseDashboardStatesWidget["visual"];
  description: string | null;
  query: string | null;
  queryPosition: Position | null;
  span: number | null;
  conditions: PulseDashboardCondition[];
};

type Position = {
  index: number;
  line: number;
  column: number;
};

const VISUALS = new Set(["chart", "line", "bar", "stat", "gauge", "barGauge", "bargauge", "histogram", "heatmap", "table"]);
const CONTROL_KINDS = new Set(["range", "source", "entity", "entity_type", "entity-type", "entitytype", "label", "text"]);
const CONDITION_LEVELS = new Set(["warn", "critical"]);
const CONDITION_OPERATORS = new Set([">", ">=", "<", "<=", "=", "!="]);

const visualFromKeyword = (keyword: string): DashboardDslVisual["visual"] => {
  if (keyword === "chart" || keyword === "line") return "line";
  if (keyword === "bargauge") return "barGauge";
  return keyword as DashboardDslVisual["visual"];
};

const controlKindFromKeyword = (keyword: string): PulseDashboardControl["kind"] => {
  if (keyword === "entity-type" || keyword === "entitytype") return "entity_type";
  return keyword as PulseDashboardControl["kind"];
};

const titleId = (prefix: string, title: string): string =>
  `${prefix}-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "item"}`;

const variableFromLabel = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "value";

const queryWithDefaultControls = (query: string, controls: DashboardDslControl[]): string => {
  const defaults = new Map(controls.map((control) => [control.variable, quoteQueryValue(control.defaultValue)]));
  return query.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, variable: string) => defaults.get(variable) ?? match);
};

const quoteQueryValue = (value: string): string => (/[\s,=]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value);

const stripBaseId = (query: PulseExplorerQuery): PulseDashboardMetricQuery | PulseDashboardEventQuery | PulseDashboardStateQuery => {
  if (query.kind === "metric") {
    const { baseId: _baseId, ...rest } = query;
    return rest;
  }
  if (query.kind === "events") {
    const { baseId: _baseId, ...rest } = query;
    return rest;
  }
  const { baseId: _baseId, ...rest } = query;
  return rest;
};

class Parser {
  private diagnostics: DashboardDslDiagnostic[] = [];
  private position: Position = { index: 0, line: 1, column: 1 };

  constructor(private readonly input: string) {}

  parse(): Result<DashboardDslDocument> {
    this.skipWhitespace();
    const start = this.position;
    const keyword = this.readIdentifier();
    if (keyword !== "dashboard") {
      this.error(start, 'Dashboard DSL must start with dashboard "Name" { ... }');
      return { ok: false, diagnostics: this.diagnostics };
    }
    const title = this.readString();
    if (title === null) this.error(this.position, "Dashboard title must be a quoted string");
    if (!this.readOpenBrace()) this.error(this.position, 'Expected "{" after dashboard title');
    const body = this.readContainerBody(["description", "controls", "section", "card", "markdown", "row", "grid", ...VISUALS]);
    const document: DashboardDslDocument = {
      kind: "dashboard",
      title: title ?? "Dashboard",
      description: body.description,
      controls: body.controls,
      blocks: body.blocks,
    };
    this.skipWhitespace();
    if (!this.isEnd()) this.error(this.position, `Unexpected trailing content "${this.peek()}"`);
    return this.diagnostics.length ? { ok: false, diagnostics: this.diagnostics } : { ok: true, data: document, diagnostics: [] };
  }

  private readContainerBody(allowed: Iterable<string>): {
    description: string | null;
    controls: DashboardDslControl[];
    blocks: DashboardDslBlock[];
  } {
    const allowedSet = new Set(allowed);
    let description: string | null = null;
    const controls: DashboardDslControl[] = [];
    const blocks: DashboardDslBlock[] = [];
    while (!this.isEnd()) {
      this.skipWhitespace();
      if (this.peek() === "}") {
        this.advance();
        return { description, controls, blocks };
      }
      const statementStart = this.position;
      const keyword = this.readIdentifier();
      if (!keyword) {
        this.error(this.position, `Unexpected token "${this.peek() || "end of input"}"`);
        this.recoverToNextStatement();
        continue;
      }
      if (!allowedSet.has(keyword)) {
        this.error(statementStart, `Unsupported dashboard statement "${keyword}"`);
        this.recoverToNextStatement();
        continue;
      }
      if (keyword === "description") {
        const value = this.readString();
        if (value === null) this.error(this.position, "Description must be a quoted string");
        else description = value;
        continue;
      }
      if (keyword === "controls") {
        controls.push(...this.readControls(statementStart));
        continue;
      }
      if (keyword === "section") {
        const block = this.readSection(statementStart);
        if (block) blocks.push(block);
        continue;
      }
      if (keyword === "card") {
        const block = this.readCard(statementStart);
        if (block) blocks.push(block);
        continue;
      }
      if (keyword === "row" || keyword === "grid") {
        const block = this.readRow(statementStart);
        if (block) blocks.push(block);
        continue;
      }
      if (keyword === "markdown") {
        const block = this.readMarkdown(statementStart);
        if (block) blocks.push(block);
        continue;
      }
      if (VISUALS.has(keyword)) {
        const block = this.readVisual(keyword, statementStart);
        if (block) blocks.push(block);
      }
    }
    this.error(this.position, 'Missing closing "}"');
    return { description, controls, blocks };
  }

  private readControls(start: Position): DashboardDslControl[] {
    if (!this.readOpenBrace()) {
      this.error(start, 'Expected "{" after controls');
      return [];
    }
    const controls: DashboardDslControl[] = [];
    while (!this.isEnd()) {
      this.skipWhitespace();
      if (this.peek() === "}") {
        this.advance();
        break;
      }
      const controlStart = this.position;
      const keyword = this.readIdentifier();
      if (!CONTROL_KINDS.has(keyword)) {
        this.error(controlStart, `Unsupported control "${keyword || this.peek()}"`);
        this.recoverToNextStatement();
        continue;
      }
      const label = this.readString();
      if (label === null) {
        this.error(controlStart, "Control label must be a quoted string");
        this.recoverToNextStatement();
        continue;
      }
      controls.push(this.readControlOptions(controlKindFromKeyword(keyword), label));
    }
    return controls;
  }

  private readControlOptions(kind: PulseDashboardControl["kind"], label: string): DashboardDslControl {
    let variable = variableFromLabel(label);
    let defaultValue = "";
    let entityType: string | null = null;
    const options: string[] = [];
    while (!this.isEnd()) {
      this.skipInlineWhitespace();
      const next = this.peek();
      if (next === "\n" || next === "\r" || next === "}") break;
      const keyword = this.readIdentifier();
      if (keyword === "variable") {
        variable = this.readBareOrString() ?? variable;
        continue;
      }
      if (keyword === "default") {
        defaultValue = this.readBareOrString() ?? defaultValue;
        continue;
      }
      if (keyword === "type") {
        entityType = this.readBareOrString() ?? entityType;
        continue;
      }
      if (keyword === "options") {
        while (!this.isEnd()) {
          this.skipInlineWhitespace();
          if (this.peek() === "\n" || this.peek() === "\r" || this.peek() === "}") break;
          if (this.peek() === ",") {
            this.advance();
            continue;
          }
          const value = this.readBareOrString();
          if (!value) break;
          options.push(value);
        }
        continue;
      }
      this.error(this.position, `Unsupported control option "${keyword || this.peek()}"`);
      this.recoverToNextStatement();
      break;
    }
    if (!defaultValue) defaultValue = options[0] ?? (kind === "range" ? "24h" : "");
    return { kind, label, variable, defaultValue, options, entityType };
  }

  private readSection(start: Position): DashboardDslSection | null {
    const title = this.readString();
    if (title === null) {
      this.error(start, "Section title must be a quoted string");
      return null;
    }
    if (!this.readOpenBrace()) {
      this.error(this.position, 'Expected "{" after section title');
      return null;
    }
    const body = this.readContainerBody(["description", "section", "card", "markdown", "row", "grid", ...VISUALS]);
    return { kind: "section", title, description: body.description, blocks: body.blocks };
  }

  private readCard(start: Position): DashboardDslCard | null {
    const title = this.readString();
    if (title === null) {
      this.error(start, "Card title must be a quoted string");
      return null;
    }
    const span = this.readOptionalSpan();
    if (!this.readOpenBrace()) {
      this.error(this.position, 'Expected "{" after card title');
      return null;
    }
    const body = this.readContainerBody(["description", "markdown", "row", "grid", ...VISUALS]);
    return { kind: "card", title, description: body.description, span, blocks: body.blocks };
  }

  private readRow(start: Position): DashboardDslRow | null {
    const height = this.readOptionalHeight();
    if (!this.readOpenBrace()) {
      this.error(start, 'Expected "{" after row/grid');
      return null;
    }
    const body = this.readContainerBody(["card", "markdown", ...VISUALS]);
    return { kind: "row", height, blocks: body.blocks };
  }

  private readMarkdown(start: Position): DashboardDslMarkdown | null {
    const title = this.tryReadString();
    const span = this.readOptionalSpan();
    if (!this.readOpenBrace()) {
      this.error(start, 'Expected "{" after markdown');
      return null;
    }
    let description: string | null = null;
    let content: string | null = null;
    while (!this.isEnd()) {
      this.skipWhitespace();
      if (this.peek() === "}") {
        this.advance();
        break;
      }
      if (this.startsWith('"""')) {
        content = this.readTripleString();
        continue;
      }
      const statementStart = this.position;
      const keyword = this.readIdentifier();
      if (keyword === "description") {
        const value = this.readString();
        if (value === null) this.error(this.position, "Description must be a quoted string");
        else description = value;
        continue;
      }
      this.error(statementStart, `Unsupported markdown statement "${keyword || this.peek()}"`);
      this.recoverToNextStatement();
    }
    if (content === null) this.error(start, "Markdown block must contain a triple-quoted string");
    return content === null ? null : { kind: "markdown", title, description, markdown: content.trim(), span };
  }

  private readVisual(keyword: string, start: Position): DashboardDslVisual | null {
    const title = this.readString();
    if (title === null) {
      this.error(start, "Widget title must be a quoted string");
      return null;
    }
    const span = this.readOptionalSpan();
    if (!this.readOpenBrace()) {
      this.error(this.position, 'Expected "{" after widget title');
      return null;
    }
    let description: string | null = null;
    let query: string | null = null;
    let queryPosition: Position | null = null;
    let visual = visualFromKeyword(keyword);
    const conditions: PulseDashboardCondition[] = [];
    while (!this.isEnd()) {
      this.skipWhitespace();
      if (this.peek() === "}") {
        this.advance();
        break;
      }
      const statementStart = this.position;
      const statement = this.readIdentifier();
      if (statement === "description") {
        const value = this.readString();
        if (value === null) this.error(this.position, "Description must be a quoted string");
        else description = value;
        continue;
      }
      if (statement === "visual") {
        const value = this.readIdentifier();
        if (!value || !VISUALS.has(value)) this.error(statementStart, "Visual must be one of chart, line, bar, stat, gauge, barGauge, histogram, heatmap, or table");
        else visual = visualFromKeyword(value);
        continue;
      }
      if (statement === "query") {
        queryPosition = statementStart;
        query = this.readLine().trim();
        continue;
      }
      if (CONDITION_LEVELS.has(statement)) {
        const condition = this.readCondition(statement as PulseDashboardCondition["level"], statementStart);
        if (condition) conditions.push(condition);
        continue;
      }
      this.error(statementStart, `Unsupported widget statement "${statement || this.peek()}"`);
      this.recoverToNextStatement();
    }
    if (!query) this.error(start, `Widget "${title}" must contain a query statement`);
    return { kind: "visual", title, visual, description, query, queryPosition, span, conditions };
  }

  private readCondition(level: PulseDashboardCondition["level"], start: Position): PulseDashboardCondition | null {
    const when = this.readIdentifier();
    if (when !== "when") {
      this.error(start, `${level} condition must use "when"`);
      this.recoverToNextStatement();
      return null;
    }
    const subject = this.readIdentifier();
    if (subject !== "value") {
      this.error(start, `${level} condition currently supports only "value"`);
      this.recoverToNextStatement();
      return null;
    }
    this.skipInlineWhitespace();
    const operator = this.readOperator();
    if (!CONDITION_OPERATORS.has(operator)) {
      this.error(start, `Unsupported condition operator "${operator}"`);
      this.recoverToNextStatement();
      return null;
    }
    const rawValue = this.readBareOrString();
    if (!rawValue) {
      this.error(start, "Condition value is missing");
      this.recoverToNextStatement();
      return null;
    }
    let message: string | null = null;
    this.skipInlineWhitespace();
    const maybeMessage = this.readIdentifier();
    if (maybeMessage === "message") message = this.readString();
    else if (maybeMessage) this.recoverToNextStatement();
    return { level, operator: operator as PulseDashboardCondition["operator"], value: parseConditionValue(rawValue), message };
  }

  private readOptionalHeight(): PulseDashboardRow["height"] {
    const checkpoint = this.position;
    this.skipWhitespace();
    const keyword = this.readIdentifier();
    if (keyword !== "height") {
      this.position = checkpoint;
      return "md";
    }
    const value = this.readIdentifier();
    return value === "sm" || value === "lg" ? value : "md";
  }

  private readOptionalSpan(): number | null {
    const checkpoint = this.position;
    this.skipWhitespace();
    const keyword = this.readIdentifier();
    if (keyword !== "span") {
      this.position = checkpoint;
      return null;
    }
    this.skipWhitespace();
    const start = this.position;
    const raw = this.readWhile(/[0-9]/);
    const span = Number(raw);
    if (!Number.isInteger(span) || span < 1 || span > 12) {
      this.error(start, "Span must be an integer between 1 and 12");
      return null;
    }
    return span;
  }

  private readOpenBrace(): boolean {
    this.skipWhitespace();
    if (this.peek() !== "{") return false;
    this.advance();
    return true;
  }

  private readIdentifier(): string {
    this.skipWhitespace();
    return this.readWhile(/[A-Za-z0-9_-]/);
  }

  private tryReadString(): string | null {
    const checkpoint = this.position;
    const value = this.readString();
    if (value === null) this.position = checkpoint;
    return value;
  }

  private readBareOrString(): string | null {
    this.skipWhitespace();
    const quoted = this.tryReadString();
    if (quoted !== null) return quoted;
    const value = this.readWhile(/[^\s,}]/);
    return value || null;
  }

  private readOperator(): string {
    const first = this.peek();
    if ((first === ">" || first === "<" || first === "!" || first === "=") && this.input[this.position.index + 1] === "=") {
      const value = `${first}=`;
      this.advance();
      this.advance();
      return value;
    }
    if (first === ">" || first === "<" || first === "=") return this.advance();
    return "";
  }

  private readString(): string | null {
    this.skipWhitespace();
    if (this.peek() !== '"') return null;
    this.advance();
    let value = "";
    while (!this.isEnd()) {
      const char = this.advance();
      if (char === '"') return value;
      if (char === "\\") {
        const next = this.advance();
        value += next === "n" ? "\n" : next === "t" ? "\t" : next;
      } else {
        value += char;
      }
    }
    this.error(this.position, "Unterminated string");
    return null;
  }

  private readTripleString(): string {
    this.advance();
    this.advance();
    this.advance();
    let value = "";
    while (!this.isEnd()) {
      if (this.startsWith('"""')) {
        this.advance();
        this.advance();
        this.advance();
        return value;
      }
      value += this.advance();
    }
    this.error(this.position, "Unterminated triple-quoted string");
    return value;
  }

  private readLine(): string {
    let value = "";
    while (!this.isEnd()) {
      const char = this.peek();
      if (char === "\n" || char === "\r" || char === "}") return value;
      value += this.advance();
    }
    return value;
  }

  private recoverToNextStatement() {
    while (!this.isEnd()) {
      const char = this.peek();
      if (char === "\n" || char === "}") return;
      this.advance();
    }
  }

  private skipWhitespace() {
    while (!this.isEnd()) {
      const char = this.peek();
      if (char === "#") {
        this.readLine();
        continue;
      }
      if (char === "/" && this.input[this.position.index + 1] === "/") {
        this.readLine();
        continue;
      }
      if (!/\s/.test(char)) return;
      this.advance();
    }
  }

  private skipInlineWhitespace() {
    while (!this.isEnd()) {
      const char = this.peek();
      if (char !== " " && char !== "\t") return;
      this.advance();
    }
  }

  private readWhile(pattern: RegExp): string {
    let value = "";
    while (!this.isEnd() && pattern.test(this.peek())) value += this.advance();
    return value;
  }

  private startsWith(value: string): boolean {
    return this.input.startsWith(value, this.position.index);
  }

  private peek(): string {
    return this.input[this.position.index] ?? "";
  }

  private isEnd(): boolean {
    return this.position.index >= this.input.length;
  }

  private advance(): string {
    const char = this.input[this.position.index] ?? "";
    this.position = {
      index: this.position.index + 1,
      line: char === "\n" ? this.position.line + 1 : this.position.line,
      column: char === "\n" ? 1 : this.position.column + 1,
    };
    return char;
  }

  private error(position: Position, message: string) {
    this.diagnostics.push({ severity: "error", message, line: position.line, column: position.column });
  }
}

const parseConditionValue = (value: string): string | number | boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && value.trim() !== "" ? numeric : value;
};

export const parseDashboardDsl = (input: string): Result<DashboardDslDocument> => new Parser(input).parse();

type CompileQuery = (query: string) => { ok: true; data: PulseExplorerQuery } | { ok: false; message: string };

export const compileDashboardDsl = (input: string, compileQuery: CompileQuery): Result<PulseDashboardConfig> => {
  const parsed = parseDashboardDsl(input);
  if (!parsed.ok) return parsed;
  const diagnostics: DashboardDslDiagnostic[] = [];
  const document = parsed.data;
  const idCounts = new Map<string, number>();
  const uniqueId = (prefix: string, title: string): string => {
    const base = titleId(prefix, title);
    const count = idCounts.get(base) ?? 0;
    idCounts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };

  const controls: PulseDashboardControl[] = document.controls.map((control) => ({
    id: uniqueId("control", control.variable),
    kind: control.kind,
    variable: control.variable,
    label: control.label,
    defaultValue: control.defaultValue,
    options: control.options.length ? control.options : undefined,
    entityType: control.entityType,
  }));

  const compileBlocksToRows = (blocks: DashboardDslBlock[], parentTitle: string): PulseDashboardRow[] => {
    const rows: PulseDashboardRow[] = [];
    let pending: PulseDashboardWidget[] = [];
    const pushPending = () => {
      if (!pending.length) return;
      rows.push({ id: uniqueId("row", `${parentTitle}-${rows.length + 1}`), kind: "row", height: "md", cells: pending });
      pending = [];
    };
    for (const block of blocks) {
      if (block.kind === "row") {
        pushPending();
        const cells = block.blocks.map((item) => compileWidget(item)).filter((item): item is PulseDashboardWidget => item !== null);
        if (cells.length) rows.push({ id: uniqueId("row", `${parentTitle}-${rows.length + 1}`), kind: "row", height: block.height, cells });
        continue;
      }
      if (block.kind === "section") continue;
      const widget = compileWidget(block);
      if (widget) pending.push(widget);
    }
    pushPending();
    return rows;
  };

  const compileWidget = (block: DashboardDslBlock): PulseDashboardWidget | null => {
    if (block.kind === "markdown") {
      const widget: PulseDashboardMarkdownWidget = {
        id: uniqueId("markdown", block.title ?? block.markdown.slice(0, 24)),
        kind: "markdown",
        markdown: block.markdown,
        span: block.span ?? undefined,
      };
      if (block.title) widget.title = block.title;
      if (block.description) widget.description = block.description;
      return widget;
    }
    if (block.kind === "card") {
      const rows = compileBlocksToRows(block.blocks, block.title);
      if (!rows.length) return null;
      return {
        id: uniqueId("card", block.title),
        kind: "card",
        title: block.title,
        description: block.description,
        span: block.span ?? undefined,
        rows,
      };
    }
    if (block.kind === "visual") {
      if (!block.query) return null;
      const resolvedQueryText = queryWithDefaultControls(block.query, document.controls);
      const query = compileQuery(resolvedQueryText);
      if (!query.ok) {
        diagnostics.push({
          severity: "error",
          message: query.message,
          line: block.queryPosition?.line ?? 1,
          column: block.queryPosition?.column ?? 1,
        });
        return null;
      }
      if (query.data.kind === "metric") return compileMetricWidget(block, query.data);
      if (query.data.kind === "events") return compileEventsWidget(block, query.data);
      return compileStatesWidget(block, query.data);
    }
    return null;
  };

  const compileMetricWidget = (block: DashboardDslVisual, query: MetricQuery): PulseDashboardMetricWidget | null => {
    const widget: PulseDashboardMetricWidget = {
      id: uniqueId("metric", block.title),
      kind: "metric",
      title: block.title,
      description: block.description,
      metric: query.metric,
      visual: block.visual === "table" || block.visual === "stat" || block.visual === "gauge" || block.visual === "barGauge" || block.visual === "bar" || block.visual === "histogram" || block.visual === "heatmap" ? block.visual : "line",
      aggregation: query.aggregation,
      bucket: query.bucket,
      since: query.since,
      sourceId: query.sourceId,
      entityId: query.entityId,
      entityType: query.entityType,
      dimensions: query.dimensions,
      queryText: block.query ?? undefined,
      query: stripBaseId(query) as PulseDashboardMetricQuery,
      conditions: block.conditions.length ? block.conditions : undefined,
      span: block.span ?? undefined,
    };
    return widget;
  };

  const compileEventsWidget = (block: DashboardDslVisual, query: EventQuery): PulseDashboardEventsWidget | null => {
    if (block.visual !== "table") {
      diagnostics.push({
        severity: "error",
        message: `Events widget "${block.title}" must use table visual`,
        line: block.queryPosition?.line ?? 1,
        column: block.queryPosition?.column ?? 1,
      });
      return null;
    }
    return {
      id: uniqueId("events", block.title),
      kind: "events",
      title: block.title,
      visual: "table",
      description: block.description,
      queryText: block.query ?? "",
      query: stripBaseId(query) as PulseDashboardEventQuery,
      conditions: block.conditions.length ? block.conditions : undefined,
      span: block.span ?? undefined,
    };
  };

  const compileStatesWidget = (block: DashboardDslVisual, query: StateQuery): PulseDashboardStatesWidget | null => {
    if (block.visual !== "table" && block.visual !== "stat") {
      diagnostics.push({
        severity: "error",
        message: `States widget "${block.title}" must use table or stat visual`,
        line: block.queryPosition?.line ?? 1,
        column: block.queryPosition?.column ?? 1,
      });
      return null;
    }
    return {
      id: uniqueId("states", block.title),
      kind: "states",
      title: block.title,
      visual: block.visual,
      description: block.description,
      queryText: block.query ?? "",
      query: stripBaseId(query) as PulseDashboardStateQuery,
      conditions: block.conditions.length ? block.conditions : undefined,
      span: block.span ?? undefined,
    };
  };

  const compileSection = (section: DashboardDslSection): PulseDashboardSection => ({
    id: uniqueId("section", section.title),
    kind: "section",
    title: section.title,
    description: section.description,
    rows: compileBlocksToRows(section.blocks, section.title),
    sections: section.blocks.filter((block): block is DashboardDslSection => block.kind === "section").map(compileSection),
  });

  const sections = document.blocks.filter((block): block is DashboardDslSection => block.kind === "section").map(compileSection);
  const topRows = compileBlocksToRows(document.blocks, document.title);
  const layout: PulseDashboardLayout = {
    version: 1,
    description: document.description,
    controls: controls.length ? controls : undefined,
    sections: topRows.length
      ? [{ id: uniqueId("section", document.title), kind: "section", title: document.title, description: null, rows: topRows, sections }]
      : sections,
  };

  if (diagnostics.length) return { ok: false, diagnostics };
  if (layout.sections.length === 0) return { ok: false, diagnostics: [{ severity: "error", message: "Dashboard must contain at least one section or widget", line: 1, column: 1 }] };
  return { ok: true, data: { layout, dsl: input.trim() }, diagnostics: [] };
};
