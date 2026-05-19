import { bookshopTemplate } from "./bookshop";
import { contentTemplate } from "./content";
import { crmTemplate } from "./crm";
import { financeTemplate } from "./finance";
import type { GridTemplate } from "./types";

export type { GridTemplate, TemplateDashboard, TemplateField, TemplateForm, TemplateRecord, TemplateRef, TemplateTable, TemplateValue, TemplateView } from "./types";

export const templates: GridTemplate[] = [
  bookshopTemplate,
  crmTemplate,
  contentTemplate,
  financeTemplate,
];

export const getTemplate = (id: string): GridTemplate | null =>
  templates.find((template) => template.id === id) ?? null;
