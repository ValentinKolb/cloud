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
const PH_OPEN = String.fromCharCode(0xe000);
const PH_CLOSE = String.fromCharCode(0xe001);

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// NOTE: link previews are rendered as `<span>`, never `<a href>`, so
// the editor itself never produces a clickable target — clicks pass
// through the textarea overlay anyway. URL sanitisation only matters
// in the downstream renderer (the `.prose` HTML in read-mode), not
// here. Keeping link payloads as escaped text + dim-coloured syntax
// is enough for the preview-as-cursor-alignment-mirror use case.

type Sanctuaries = Map<string, string>;

const extractSanctuaries = (input: string): { text: string; sanctuaries: Sanctuaries } => {
  const sanctuaries: Sanctuaries = new Map();
  let counter = 0;
  const issue = (): string => `${PH_OPEN}${counter++}${PH_CLOSE}`;

  let text = input;

  // Inline code first — match runs of N backticks paired by N backticks.
  // Content is restricted to single-line (no `\n`) so this regex can't
  // accidentally swallow a fenced code block like ```\n…\n``` — fences
  // are detected later in the block-level pass. Mirrors overtype's
  // parser logic but with stricter single-line scope.
  text = text.replace(/(?<!`)(`+)(?!`)([^\n]+?)\1(?!`)/g, (_match, ticks: string, content: string) => {
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
    const ph = issue();
    sanctuaries.set(ph, `<span class="md-link"><span class="md-syntax">[</span>${label}<span class="md-syntax">](${url})</span></span>`);
    return ph;
  });

  return { text, sanctuaries };
};

const restoreSanctuaries = (html: string, sanctuaries: Sanctuaries): string => {
  // Sanctuaries are unique unicode markers; a single split/join per
  // placeholder is cheap and avoids any regex parsing of the markers.
  //
  // Order matters: we restore in REVERSE insertion order so that
  // outer wrappers (links) are restored before their inner content
  // (code spans) — the link's stored HTML contains the code
  // placeholder, and we need that placeholder to land in the live
  // string BEFORE we try to substitute it with the code HTML. Without
  // this, `[`x`](url)` would leak the raw code placeholder into the
  // rendered link label.
  const entries = [...sanctuaries].reverse();
  for (const [ph, replacement] of entries) {
    if (html.includes(ph)) html = html.split(ph).join(replacement);
  }
  return html;
};

// Separate PUA range for the bold sanctuary, so its placeholders can't
// collide with the outer code/link sanctuaries (those use /).
const BOLD_PH_OPEN = String.fromCharCode(0xe002);
const BOLD_PH_CLOSE = String.fromCharCode(0xe003);

// Third PUA range for the completion-match sanctuary. Distinct from
// the code/link and bold sanctuaries so each pipeline stage can
// restore its own placeholders without collisions.
const MATCH_PH_OPEN = String.fromCharCode(0xe004);
const MATCH_PH_CLOSE = String.fromCharCode(0xe005);

// Escape a string for safe use as a regex literal. Used when building
// the alternation of known completion labels for the document scan.
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build a regex that matches any of `labels` as a standalone word.
 *  The negative lookarounds use word-character classes so a label
 *  starting with `#` like `#alice` still matches in plain prose
 *  (because `#` is not a word char, the leading boundary collapses
 *  to "anything but a word char"). */
const buildMatchRegex = (labels: Set<string>): RegExp | null => {
  if (labels.size === 0) return null;
  const sorted = [...labels].sort((a, b) => b.length - a.length).map(escapeRegex);
  return new RegExp(`(?<![\\p{L}\\p{N}_])(${sorted.join("|")})(?![\\p{L}\\p{N}_])`, "gu");
};

/** Italic-only pass — split out so we can call it recursively on a
 *  bold span's inner content (so things like `**foo *bar* baz**`
 *  render with italic inside bold). */
const processItalic = (text: string): string => {
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
 * Inline pass — bold + italic with nesting support.
 *
 * Naïve order (bold-then-italic) breaks symmetric nesting:
 *   - `*foo **bar** baz*` — the outer italic can't span the bold span
 *     because the bold pass writes `*` into the visible syntax markers
 *     and the italic regex can't cross those literal asterisks.
 *
 * Fix: bold is sanctuarised first. The bold content is recursively
 * italic-processed and stored under a placeholder (PUA chars), so the
 * italic pass sees only plain text + opaque markers. Both directions
 * of nesting (italic-in-bold and bold-in-italic) work.
 *
 * Bold's inner-content regex `(?:[^*\n]|\*[^*\n]+?\*)+?` allows either
 * plain non-asterisk chars OR an `*…*` italic pair, so a bold can
 * still match across embedded italic — same pattern, mirrored for `__`.
 */
const processInline = (text: string, matchRegex: RegExp | null = null): string => {
  const sanctuaries = new Map<string, string>();
  let counter = 0;
  const issue = (): string => `${BOLD_PH_OPEN}${counter++}${BOLD_PH_CLOSE}`;

  text = text.replace(/\*\*((?:[^*\n]|\*[^*\n]+?\*)+?)\*\*/g, (_match, inner: string) => {
    // Recurse with the SAME match regex so labels inside bold spans
    // are highlighted too.
    const innerProcessed = processItalicAndMatches(inner, matchRegex);
    const ph = issue();
    sanctuaries.set(ph, `<span class="md-bold"><span class="md-syntax">**</span>${innerProcessed}<span class="md-syntax">**</span></span>`);
    return ph;
  });
  text = text.replace(/__((?:[^_\n]|_[^_\n]+?_)+?)__/g, (_match, inner: string) => {
    const innerProcessed = processItalicAndMatches(inner, matchRegex);
    const ph = issue();
    sanctuaries.set(ph, `<span class="md-bold"><span class="md-syntax">__</span>${innerProcessed}<span class="md-syntax">__</span></span>`);
    return ph;
  });

  text = processItalicAndMatches(text, matchRegex);

  for (const [ph, html] of sanctuaries) {
    if (text.includes(ph)) text = text.split(ph).join(html);
  }
  return text;
};

/** Match-extract + italic pass. Pulled into its own helper so bold
 *  recursion shares the same logic. Matches are extracted to a third
 *  PUA sanctuary BEFORE italic so the italic regex doesn't trip on
 *  `<span>` chars inside a wrapped label. */
const processItalicAndMatches = (text: string, matchRegex: RegExp | null): string => {
  if (!matchRegex) return processItalic(text);
  const matchSanctuary = new Map<string, string>();
  let counter = 0;
  const issue = (): string => `${MATCH_PH_OPEN}${counter++}${MATCH_PH_CLOSE}`;
  // Reset regex state — buildMatchRegex returns a `/g` regex which
  // carries lastIndex between calls.
  matchRegex.lastIndex = 0;
  text = text.replace(matchRegex, (label: string) => {
    const ph = issue();
    matchSanctuary.set(ph, `<span class="md-completion-match">${label}</span>`);
    return ph;
  });
  text = processItalic(text);
  for (const [ph, html] of matchSanctuary) {
    if (text.includes(ph)) text = text.split(ph).join(html);
  }
  return text;
};

/**
 * Block-level transform for a single line (no newline inside `line`).
 */
const processLine = (line: string, matchRegex: RegExp | null = null): string => {
  // Empty line — keep as-is so the preview's pre-wrap renders a blank
  // line at the same position as in the textarea.
  if (line.length === 0) return "";

  // Header (1–3 hashes only — h4+ aren't typographically distinct in
  // our font-weight-only scheme, so we don't pretend to support them).
  const header = /^(#{1,3})(\s)(.*)$/.exec(line);
  if (header) {
    const [, hashes, ws, content] = header;
    return `<span class="md-h${hashes!.length}"><span class="md-syntax">${hashes}${ws}</span>${processInline(content!, matchRegex)}</span>`;
  }

  // Horizontal rule — `---`, `***`, or `___` alone on a line.
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
    return `<span class="md-hr">${line}</span>`;
  }

  // Blockquote (`>` is HTML-escaped to `&gt;` by this point).
  const quote = /^(&gt;)(\s)(.*)$/.exec(line);
  if (quote) {
    return `<span class="md-quote"><span class="md-syntax">${quote[1]}${quote[2]}</span>${processInline(quote[3]!, matchRegex)}</span>`;
  }

  // Bullet list: `- `, `* `, `+ ` with optional leading indent.
  const bullet = /^(\s*)([-*+])(\s)(.*)$/.exec(line);
  if (bullet) {
    const [, indent, marker, ws, content] = bullet;
    return `${indent}<span class="md-marker">${marker}${ws}</span>${processInline(content!, matchRegex)}`;
  }

  // Numbered list: `1. ` etc.
  const numbered = /^(\s*)(\d+\.)(\s)(.*)$/.exec(line);
  if (numbered) {
    const [, indent, marker, ws, content] = numbered;
    return `${indent}<span class="md-marker">${marker}${ws}</span>${processInline(content!, matchRegex)}`;
  }

  // Plain paragraph line — just inline pass.
  return processInline(line, matchRegex);
};

export type HighlightOptions = {
  /** When set, every occurrence of these labels (as a standalone word
   * outside code spans/fences) is wrapped in `.md-completion-match`
   * for the document-wide highlight effect. Pass the set returned by
   * `collectKnownLabels` from `completions.ts`. */
  knownLabels?: Set<string>;
};

/**
 * Render a markdown string as syntax-highlighted HTML for the preview
 * layer. The output is safe to insert via `innerHTML` because the input
 * is HTML-escaped before any markdown transforms run.
 */
export const highlightMarkdown = (text: string, options: HighlightOptions = {}): string => {
  const matchRegex = options.knownLabels ? buildMatchRegex(options.knownLabels) : null;
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
    out.push(processLine(line, matchRegex));
  }

  const html = restoreSanctuaries(out.join("\n"), sanctuaries);

  // A `<textarea>` reserves an empty final line for the caret when its
  // value ends in "\n", but a `white-space: pre-wrap` block swallows
  // that single trailing newline and renders one line shorter. The
  // mismatch makes the preview's scrollHeight smaller than the
  // textarea's, so the scroll-sync clamps and the visible text drifts
  // up to one line near the bottom. Append one extra newline to mirror
  // the textarea's phantom last line. Only the LAST trailing newline is
  // dropped by the layout, so a single extra suffices for any run of
  // trailing blanks.
  return text.endsWith("\n") ? `${html}\n` : html;
};
