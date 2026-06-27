import { Liquid } from "liquidjs";

const TEMPLATE_MAX_BYTES = 200_000;
const RENDER_MAX_BYTES = 300_000;

const ALLOWED_TAGS = new Set([
  "if",
  "elsif",
  "else",
  "endif",
  "unless",
  "endunless",
  "for",
  "break",
  "continue",
  "endfor",
  "case",
  "when",
  "endcase",
  "assign",
  "capture",
  "endcapture",
  "comment",
  "endcomment",
  "raw",
  "endraw",
]);

const TEMPLATE_TAG_RE = /{%-?\s*([A-Za-z_][A-Za-z0-9_]*)\b/g;

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

export const escapeTemplateOutput = (value: unknown): string =>
  String(value).replace(/[&<>"'`=/]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      case "`":
        return "&#x60;";
      case "=":
        return "&#x3D;";
      case "/":
        return "&#x2F;";
      default:
        return char;
    }
  });

const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
  ownPropertyOnly: true,
  outputEscape: escapeTemplateOutput,
  parseLimit: TEMPLATE_MAX_BYTES,
  renderLimit: RENDER_MAX_BYTES,
  memoryLimit: 2_000_000,
  cache: false,
  dynamicPartials: false,
  root: [],
  layouts: [],
  partials: [],
});

export const migrateLegacyMustacheTemplate = (template: string): string =>
  template
    .replace(/{{#\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}([\s\S]*?){{\/\s*\1\s*}}/g, "{% if $1 != blank %}$2{% endif %}")
    .replace(/{{\^\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}([\s\S]*?){{\/\s*\1\s*}}/g, "{% if $1 == blank %}$2{% endif %}");

export const validateLiquidTemplate = (template: string): { ok: true } | { ok: false; error: string } => {
  if (byteLength(template) > TEMPLATE_MAX_BYTES) return { ok: false, error: "Template is too large" };
  for (const match of template.matchAll(TEMPLATE_TAG_RE)) {
    const tag = match[1]!;
    if (!ALLOWED_TAGS.has(tag)) return { ok: false, error: `Liquid tag "${tag}" is not allowed` };
  }
  try {
    engine.parse(template);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid Liquid template" };
  }
};

export const renderLiquidTemplate = (template: string, data: Record<string, unknown>): string => {
  const valid = validateLiquidTemplate(template);
  if (!valid.ok) throw new Error(valid.error);
  const rendered = engine.parseAndRenderSync(template, data);
  if (byteLength(rendered) > RENDER_MAX_BYTES) throw new Error("Rendered template is too large");
  return rendered;
};
