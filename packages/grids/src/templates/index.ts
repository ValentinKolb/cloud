import { bookshopTemplate } from "./bookshop";
import { financeTemplate } from "./finance";
import { inventoryTemplate } from "./inventory";
import type { GridTemplate } from "./types";

export type {
  GridTemplate,
  TemplateDashboard,
  TemplateDateExpression,
  TemplateField,
  TemplateForm,
  TemplateRecord,
  TemplateRef,
  TemplateTable,
  TemplateValue,
  TemplateView,
} from "./types";

export const templates: GridTemplate[] = [
  bookshopTemplate,
  financeTemplate,
  inventoryTemplate,
];

export const getTemplate = (id: string): GridTemplate | null =>
  templates.find((template) => template.id === id) ?? null;
