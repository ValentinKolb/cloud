/**
 * Markdown highlighter for the overtype-style editor.
 *
 * Input: plain text (the textarea's current value).
 * Output: an HTML string that's injected into the preview div via
 * `innerHTML`. Whitespace is preserved 1:1 because both layers run with
 * `white-space: pre-wrap`. Newlines in the output are real `\n`
 * characters — the preview never adds extra wrappers around lines.
 *
 * The visible markdown syntax characters (`**`, `#`, `-`, etc.) are kept
 * in the output, wrapped in a dimmed `.md-syntax` span. This is the
 * core of the overtype trick: the textarea's char positions must match
 * the preview's char positions exactly, so we can't elide any source
 * characters in the rendered version.
 *
 * Parsing happens in three passes:
 *
 *   1. HTML-escape the entire text.
 *   2. Sanctuary extraction: pull inline-code spans (`` `…` ``) and
 *      links (`[text](url)`) out into placeholder tokens BEFORE any
 *      other regex runs. This prevents `*italic*` from matching inside
 *      a URL, and prevents code-span content from being mistaken for
 *      bold/italic markdown. Lesson from overtype issue #81.
 *   3. Block + inline pass per line, then placeholders are restored.
 */

// Private Use Area chars for sanctuary placeholders — they will never
// appear in user input and won't be matched by any markdown regex.
const PH_OPEN = "";
const PH_CLOSE = "";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Conservative URL sanitiser — accepts http/https/mailto and relative
 * URLs, rejects javascript:, data:, etc. Returns "#" for rejected URLs
 * so the rendered anchor remains harmless if clicked.
 */
const sanitizeUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "#";
  // Relative or anchor
  if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("?")) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("mailto:")) return trimmed;
  // No protocol — treat as http
  if (!/^[a-z][a-z0-9+.-]*:/.test(lower)) return trimmed;
  return "#";
};

type Sanctuaries = Map<string, string>;

const extractSanctuaries = (input: string): { text: string; sanctuaries: Sanctuaries } => {
  const sanctuaries: Sanctuaries = new Map();
  let counter = 0;
  const issue = (): string => `${PH_OPEN}${counter++}${PH_CLOSE}`;

  let text = input;

  // Inline code first — match runs of N backticks paired by N backticks.
  // Negative look-behind/-ahead so adjacent backticks don't accidentally
  // form a longer fence. Mirrors overtype/parser.js inline-code rule.
  text = text.replace(/(?<!`)(`+)(?!`)([\s\S]+?)\1(?!`)/g, (_match, ticks: string, content: string) => {
    const ph = issue();
    sanctuaries.set(
      ph,
      `<span class="md-code"><span class="md-syntax">${ticks}</span>${content}<span class="md-syntax">${ticks}</span></span>`,
    );
    return ph;
  });

  // Then links [text](url). HTML was escaped earlier, so brackets show
  // as literal `[` / `]` here. The URL part is rendered as plain dim
  // text (not as a clickable anchor target) inside the syntax span; the
  // outer <a> wraps the whole construct so the visible label is what's
  // hoverable. The textarea sits on top with pointer-events, so clicks
  // don't follow the link by default — that's intentional, otherwise
  // selecting text by clicking would navigate away mid-edit.
  text = text.replace(/\[([^\]\n]+?)\]\(([^)\n]+?)\)/g, (_match, label: string, url: string) => {
    // sanitizeUrl is called for its validation side; the displayed
    // URL stays raw so the user sees what they typed. The preview has
    // pointer-events: none so clicks never reach a link target — the
    // editor is for editing, not navigation.
    sanitizeUrl(url);
    const ph = issue();
    sanctuaries.set(
      ph,
      `<span class="md-link"><span class="md-syntax">[</span>${label}<span class="md-syntax">](${url})</span></span>`,
    );
    return ph;
  });

  return { text, sanctuaries };
};

const restoreSanctuaries = (html: string, sanctuaries: Sanctuaries): string => {
  // Sanctuaries are unique unicode markers; a single split/join per
  // placeholder is cheap and avoids any regex parsing of the markers.
  for (const [ph, replacement] of sanctuaries) {
    if (html.includes(ph)) html = html.split(ph).join(replacement);
  }
  return html;
};

/**
 * Inline-level transforms: bold, italic. Order matters — `**bold**`
 * MUST be processed before `*italic*` so the outer asterisks aren't
 * mistaken for italic delimiters.
 */
const processInline = (text: string): string => {
  // Bold: ** … ** and __ … __
  text = text.replace(
    /\*\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*\*/g,
    '<span class="md-bold"><span class="md-syntax">**</span>$1<span class="md-syntax">**</span></span>',
  );
  text = text.replace(
    /__([^\s_][^_\n]*?[^\s_]|[^\s_])__/g,
    '<span class="md-bold"><span class="md-syntax">__</span>$1<span class="md-syntax">__</span></span>',
  );
  // Italic: single `*` not adjacent to `*`, single `_` at word
  // boundaries (avoid matching inside_words and bullet markers like
  // `* foo` at column 0 — those are handled at block level before this
  // function runs). Lesson from overtype issue #81.
  text = text.replace(
    /(^|[^*\w])\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*(?!\*)/g,
    '$1<span class="md-italic"><span class="md-syntax">*</span>$2<span class="md-syntax">*</span></span>',
  );
  text = text.replace(
    /(^|[^\w_])_([^\s_][^_\n]*?[^\s_]|[^\s_])_(?!\w)/g,
    '$1<span class="md-italic"><span class="md-syntax">_</span>$2<span class="md-syntax">_</span></span>',
  );
  return text;
};

/**
 * Block-level transform for a single line (no newline inside `line`).
 */
const processLine = (line: string): string => {
  // Empty line — keep as-is so the preview's pre-wrap renders a blank
  // line at the same position as in the textarea.
  if (line.length === 0) return "";

  // Header (1–3 hashes only — h4+ aren't typographically distinct in
  // our font-weight-only scheme, so we don't pretend to support them).
  const header = /^(#{1,3})\s(.*)$/.exec(line);
  if (header) {
    const [, hashes, content] = header;
    return `<span class="md-h${hashes!.length}"><span class="md-syntax">${hashes} </span>${processInline(content!)}</span>`;
  }

  // Horizontal rule — `---`, `***`, or `___` alone on a line.
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
    return `<span class="md-hr">${line}</span>`;
  }

  // Blockquote (`>` is HTML-escaped to `&gt;` by this point).
  const quote = /^(&gt;)\s(.*)$/.exec(line);
  if (quote) {
    return `<span class="md-quote"><span class="md-syntax">${quote[1]} </span>${processInline(quote[2]!)}</span>`;
  }

  // Bullet list: `- `, `* `, `+ ` with optional leading indent.
  const bullet = /^(\s*)([-*+])\s(.*)$/.exec(line);
  if (bullet) {
    const [, indent, marker, content] = bullet;
    return `${indent}<span class="md-marker">${marker} </span>${processInline(content!)}`;
  }

  // Numbered list: `1. ` etc.
  const numbered = /^(\s*)(\d+\.)\s(.*)$/.exec(line);
  if (numbered) {
    const [, indent, marker, content] = numbered;
    return `${indent}<span class="md-marker">${marker} </span>${processInline(content!)}`;
  }

  // Plain paragraph line — just inline pass.
  return processInline(line);
};

/**
 * Render a markdown string as syntax-highlighted HTML for the preview
 * layer. The output is safe to insert via `innerHTML` because the input
 * is HTML-escaped before any markdown transforms run.
 */
export const highlightMarkdown = (text: string): string => {
  const escaped = escapeHtml(text);
  const { text: protectedText, sanctuaries } = extractSanctuaries(escaped);

  const lines = protectedText.split("\n");
  const out: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    // Fence open/close — three backticks at the start of a line. The
    // backticks were NOT consumed by the inline-code sanctuary pass
    // because that requires content between the ticks; a bare ``` line
    // has none.
    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence;
      out.push(`<span class="md-code-block md-syntax">${line}</span>`);
      continue;
    }
    if (inCodeFence) {
      // Inside a fence: render verbatim with code-block background, no
      // further markdown processing.
      out.push(`<span class="md-code-block">${line}</span>`);
      continue;
    }
    out.push(processLine(line));
  }

  return restoreSanctuaries(out.join("\n"), sanctuaries);
};
