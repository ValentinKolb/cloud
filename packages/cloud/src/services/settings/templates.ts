/**
 * Mustache-based template rendering for email templates stored in settings.
 */

import Mustache from "mustache";

/** Render a mustache template with variables. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return Mustache.render(template, vars);
}
