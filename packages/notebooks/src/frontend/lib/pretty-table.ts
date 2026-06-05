import {
  type EvalContext,
  evaluateFormula,
  formatValue,
  isFormula,
  isTotalRow,
  type ProgressValue,
  parseProgressValue,
} from "@valentinkolb/cloud/shared";
import { dates } from "@valentinkolb/stdlib";

export type PrettyTableAlign = "left" | "right" | "center" | null;

export type PrettyTableData = {
  caption?: string;
  headers: string[];
  rows: string[][];
  align?: PrettyTableAlign[];
};

const TAG_RE = /(^|\s)#([a-zA-Z][\w-]*(?:\/[\w-]+)*)/g;
const NOTE_LINK_RE = /\[([^\]]+)\]\(note:\/\/([0-9a-zA-Z]{6})\)/g;
const MARKDOWN_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|tel:[^)\s]+)\)/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const alignClass = (align: PrettyTableAlign): string => {
  if (align === "right") return " md-align-right";
  if (align === "center") return " md-align-center";
  return "";
};

const tagHref = (notebookId: string | undefined, tag: string): string =>
  notebookId ? `/app/notebooks/${notebookId}/tags/${encodeURIComponent(tag.toLowerCase())}` : "#";

const renderIsoDateTime = (raw: string): string | null => {
  const value = raw.trim();
  if (!ISO_DATE_TIME_RE.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `<time datetime="${escapeHtml(value)}" title="${escapeHtml(value)}">${escapeHtml(dates.formatDateTime(date))}</time>`;
};

const stashHtml = (html: string, placeholders: string[]): string => {
  placeholders.push(html);
  return `\u0000${placeholders.length - 1}\u0000`;
};

const restoreHtml = (html: string, placeholders: string[]): string =>
  html.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => placeholders[Number(index)] ?? "");

const renderInlineFormatting = (html: string): string =>
  html
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<s>$1</s>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");

const renderInlineMarkdown = (raw: string, notebookId?: string): string => {
  const formattedDateTime = renderIsoDateTime(raw);
  if (formattedDateTime) return formattedDateTime;

  const placeholders: string[] = [];
  const withProtectedLinks = raw
    .replace(NOTE_LINK_RE, (_match, label: string, shortId: string) => {
      const href = notebookId ? `/app/notebooks/${notebookId}/notes/${shortId}` : `note://${shortId}`;
      const html =
        `<a class="cm-note-link note-link inline-flex items-center gap-1 rounded-md bg-blue-50/80 px-1.5 py-0.5 text-blue-700 no-underline align-baseline font-medium shadow-[var(--theme-shadow-elevated)] hover:bg-blue-100/80 dark:bg-blue-950/35 dark:text-blue-300 dark:hover:bg-blue-900/35" href="${escapeHtml(href)}">` +
        `<i class="ti ti-connection text-xs"></i><span>${escapeHtml(label)}</span></a>`;
      return stashHtml(html, placeholders);
    })
    .replace(MARKDOWN_LINK_RE, (_match, label: string, href: string) => {
      const html = `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label)}</a>`;
      return stashHtml(html, placeholders);
    })
    .replace(INLINE_CODE_RE, (_match, code: string) => stashHtml(`<code>${escapeHtml(code)}</code>`, placeholders));

  const escaped = escapeHtml(withProtectedLinks);
  const formatted = renderInlineFormatting(escaped);
  const withTags = formatted.replace(TAG_RE, (_match, prefix: string, tag: string) => {
    const href = tagHref(notebookId, tag);
    return `${prefix}<a href="${escapeHtml(href)}" class="cm-tag-pill inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 no-underline align-baseline font-medium" title="Show notes with #${escapeHtml(tag.toLowerCase())}">#${escapeHtml(tag)}</a>`;
  });

  return restoreHtml(withTags, placeholders);
};

const renderProgressCell = (progress: ProgressValue, alignCls: string, title: string): string => {
  const pct = Math.round(progress.ratio * 100);
  return `<td><span class="md-table-cell md-table-progress${alignCls}" title="${escapeHtml(title)}"><span class="md-table-progress-track" aria-hidden="true"><span class="md-table-progress-fill" style="width:${pct}%"></span></span><span>${escapeHtml(progress.label)}</span></span></td>`;
};

const renderBodyCell = (cell: string, alignCls: string, ctx: EvalContext, notebookId?: string): string => {
  if (!isFormula(cell)) {
    return `<td><span class="md-table-cell${alignCls}">${renderInlineMarkdown(cell, notebookId)}</span></td>`;
  }
  const result = evaluateFormula(cell, ctx);
  if (result.kind === "ok") {
    const progress = parseProgressValue(result.value);
    if (progress) return renderProgressCell(progress, alignCls, cell);
    return `<td><span class="md-table-cell md-formula-ok${alignCls}" title="${escapeHtml(cell)}"><i class="ti ti-math-function"></i>${escapeHtml(formatValue(result.value))}</span></td>`;
  }
  const tooltip = result.suggestion ? `${result.message}\n→ Suggestion: ${result.suggestion}` : result.message;
  return `<td><span class="md-table-cell md-formula-error${alignCls}" title="${escapeHtml(tooltip)}">⚠ ${escapeHtml(cell)}</span></td>`;
};

export const renderPrettyTableHtml = (data: PrettyTableData, options: { notebookId?: string } = {}): string => {
  const align = data.align ?? [];
  const caption = data.caption
    ? `<div class="md-block-handle" data-block-name="${escapeHtml(data.caption)}">@${escapeHtml(data.caption)}</div>`
    : "";
  const headerHtml = data.headers
    .map((h, i) => `<th><span class="md-table-cell${alignClass(align[i] ?? null)}">${escapeHtml(h)}</span></th>`)
    .join("");
  const bodyHtml = data.rows
    .map((row, rowIdx) => {
      const totalRow = isTotalRow(row);
      const cells = data.headers
        .map((_, colIdx) => {
          const cell = row[colIdx] ?? "";
          const alignCls = alignClass(align[colIdx] ?? null);
          const ctx: EvalContext = { headers: data.headers, rows: data.rows, currentRow: rowIdx, currentCol: colIdx };
          return renderBodyCell(cell, alignCls, ctx, options.notebookId);
        })
        .join("");
      return totalRow ? `<tr class="md-table-total-row">${cells}</tr>` : `<tr>${cells}</tr>`;
    })
    .join("");
  return `${caption}<div class="md-table-wrap"><table class="md-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
};
