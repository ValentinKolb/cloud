import sanitizeHtml from "sanitize-html";

export const EMAIL_HTML_TAGS = [
  "a",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "li",
  "ol",
  "p",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

export const EMAIL_HTML_ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "target", "style"],
  div: ["style"],
  h1: ["style"],
  h2: ["style"],
  h3: ["style"],
  li: ["style"],
  ol: ["style"],
  p: ["style"],
  span: ["style"],
  table: ["style", "cellpadding", "cellspacing", "width", "align", "border"],
  tbody: ["style"],
  td: ["style", "width", "align", "valign", "colspan", "rowspan"],
  tfoot: ["style"],
  th: ["style", "width", "align", "valign", "colspan", "rowspan"],
  thead: ["style"],
  tr: ["style"],
  ul: ["style"],
};

export const EMAIL_HTML_ALLOWED_SCHEMES = ["http", "https", "mailto"] as const;

export const sanitizeEmailHtml = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: [...EMAIL_HTML_TAGS],
    allowedAttributes: EMAIL_HTML_ALLOWED_ATTRIBUTES,
    allowedSchemes: [...EMAIL_HTML_ALLOWED_SCHEMES],
  });
