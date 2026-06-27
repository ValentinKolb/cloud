import { renderLiquidTemplate } from "../../shared/template-rendering";

/** Render a Liquid template with Cloud's legacy-compatible HTML escaping. */
export const renderTemplate = (template: string, vars: Record<string, unknown>): string => renderLiquidTemplate(template, vars);
