import postcss from "postcss";
import { z } from "zod";
import { utf8ByteLength, validateLiquidRoots, validateLiquidTemplate } from "../service/document-liquid";
import type { ComputedFieldKind } from "./types";

export const HTML_TEMPLATE_TYPE = "html_template";
export const HTML_TEMPLATE_ROOTS = new Set(["record", "table", "app", "business", "date"]);
export const HTML_TEMPLATE_MAX_BYTES = 50_000;
export const HTML_TEMPLATE_CSS_MAX_BYTES = 32_000;
export const HTML_TEMPLATE_RENDER_MAX_BYTES = 300_000;
export const HTML_TEMPLATE_ERROR = "#TEMPLATE_ERROR!";

const MAX_CSS_RULES = 200;
const MAX_CSS_DECLARATIONS = 1_000;

export const validateHtmlTemplateCss = (source: string): string | null => {
  if (utf8ByteLength(source) > HTML_TEMPLATE_CSS_MAX_BYTES) return "CSS may contain at most 32 KB";
  try {
    const root = postcss.parse(source, { from: undefined });
    let rules = 0;
    let declarations = 0;
    root.walk((node) => {
      if (node.type === "rule") rules += 1;
      if (node.type === "decl") declarations += 1;
    });
    if (rules > MAX_CSS_RULES) return `CSS may contain at most ${MAX_CSS_RULES} rules`;
    if (declarations > MAX_CSS_DECLARATIONS) return `CSS may contain at most ${MAX_CSS_DECLARATIONS} declarations`;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "CSS is invalid";
  }
};

export const htmlTemplateConfigSchema = z
  .object({
    template: z.string().default(""),
    css: z.string().default(""),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (utf8ByteLength(config.template) > HTML_TEMPLATE_MAX_BYTES) {
      ctx.addIssue({ code: "custom", path: ["template"], message: "template may contain at most 50 KB" });
      return;
    }
    if (config.template) {
      const syntax = validateLiquidTemplate(config.template);
      if (!syntax.ok) {
        ctx.addIssue({ code: "custom", path: ["template"], message: syntax.error.message });
        return;
      }
      const roots = validateLiquidRoots(config.template, HTML_TEMPLATE_ROOTS, "HTML template");
      if (!roots.ok) ctx.addIssue({ code: "custom", path: ["template"], message: roots.error.message });
    }
    const cssError = validateHtmlTemplateCss(config.css);
    if (cssError) ctx.addIssue({ code: "custom", path: ["css"], message: cssError });
  });

export type HtmlTemplateConfig = z.infer<typeof htmlTemplateConfigSchema>;

export const htmlTemplateHandler: ComputedFieldKind = {
  type: HTML_TEMPLATE_TYPE,
  kind: "computed",
  configSchema: htmlTemplateConfigSchema,
};
