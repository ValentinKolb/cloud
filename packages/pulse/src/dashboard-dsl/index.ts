import type {
  PulseDashboardConfig,
  PulseDashboardLayout,
  PulseDashboardMarkdownWidget,
  PulseDashboardMetricWidget,
  PulseDashboardRow,
  PulseDashboardSection,
  PulseDashboardWidget,
  PulseExplorerQuery,
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
  blocks: DashboardDslBlock[];
};

type DashboardDslBlock = DashboardDslSection | DashboardDslCard | DashboardDslMarkdown | DashboardDslVisual | DashboardDslRow;

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
  visual: PulseDashboardMetricWidget["visual"];
  description: string | null;
  query: string | null;
  queryPosition: Position | null;
  span: number | null;
};

type Position = {
  index: number;
  line: number;
  column: number;
};

const VISUALS = new Set(["chart", "line", "bar", "stat", "gauge", "barGauge", "bargauge", "histogram", "heatmap", "table"]);

const visualFromKeyword = (keyword: string): PulseDashboardMetricWidget["visual"] => {
  if (keyword === "chart" || keyword === "line") return "line";
  if (keyword === "bargauge") return "barGauge";
  return keyword as PulseDashboardMetricWidget["visual"];
};

const titleId = (prefix: string, title: string): string =>
  `${prefix}-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "item"}`;

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
    const body = this.readContainerBody(["description", "section", "card", "markdown", "row", ...VISUALS]);
    const document: DashboardDslDocument = {
      kind: "dashboard",
      title: title ?? "Dashboard",
      description: body.description,
      blocks: body.blocks,
    };
    this.skipWhitespace();
    if (!this.isEnd()) this.error(this.position, `Unexpected trailing content "${this.peek()}"`);
    return this.diagnostics.length ? { ok: false, diagnostics: this.diagnostics } : { ok: true, data: document, diagnostics: [] };
  }

  private readContainerBody(allowed: Iterable<string>): { description: string | null; blocks: DashboardDslBlock[] } {
    const allowedSet = new Set(allowed);
    let description: string | null = null;
    const blocks: DashboardDslBlock[] = [];
    while (!this.isEnd()) {
      this.skipWhitespace();
      if (this.peek() === "}") {
        this.advance();
        return { description, blocks };
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
      if (keyword === "row") {
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
        continue;
      }
    }
    this.error(this.position, 'Missing closing "}"');
    return { description, blocks };
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
    const body = this.readContainerBody(["description", "section", "card", "markdown", "row", ...VISUALS]);
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
    const body = this.readContainerBody(["description", "markdown", "row", ...VISUALS]);
    return { kind: "card", title, description: body.description, span, blocks: body.blocks };
  }

  private readRow(start: Position): DashboardDslRow | null {
    if (!this.readOpenBrace()) {
      this.error(start, 'Expected "{" after row');
      return null;
    }
    const body = this.readContainerBody(["card", "markdown", ...VISUALS]);
    return { kind: "row", blocks: body.blocks };
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
      this.error(statementStart, `Unsupported widget statement "${statement || this.peek()}"`);
      this.recoverToNextStatement();
    }
    if (!query) this.error(start, `Widget "${title}" must contain a query statement`);
    return { kind: "visual", title, visual, description, query, queryPosition, span };
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
        if (cells.length) rows.push({ id: uniqueId("row", `${parentTitle}-${rows.length + 1}`), kind: "row", height: "md", cells });
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
      const query = compileQuery(block.query);
      if (!query.ok) {
        diagnostics.push({
          severity: "error",
          message: query.message,
          line: block.queryPosition?.line ?? 1,
          column: block.queryPosition?.column ?? 1,
        });
        return null;
      }
      if (query.data.kind !== "metric") {
        diagnostics.push({
          severity: "error",
          message: `Dashboard widget "${block.title}" currently requires a metric query`,
          line: block.queryPosition?.line ?? 1,
          column: block.queryPosition?.column ?? 1,
        });
        return null;
      }
      const widget: PulseDashboardMetricWidget = {
        id: uniqueId("metric", block.title),
        kind: "metric",
        title: block.title,
        description: block.description,
        metric: query.data.metric,
        visual: block.visual,
        aggregation: query.data.aggregation,
        bucket: query.data.bucket,
        since: query.data.since,
        sourceId: query.data.sourceId,
        dimensions: query.data.dimensions,
        span: block.span ?? undefined,
      };
      return widget;
    }
    return null;
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
    sections: topRows.length
      ? [{ id: uniqueId("section", document.title), kind: "section", title: document.title, description: null, rows: topRows, sections }]
      : sections,
  };

  if (diagnostics.length) return { ok: false, diagnostics };
  if (layout.sections.length === 0) return { ok: false, diagnostics: [{ severity: "error", message: "Dashboard must contain at least one section or widget", line: 1, column: 1 }] };
  return { ok: true, data: { panels: [], layout, dsl: input.trim() }, diagnostics: [] };
};
