export type TemplateRefKind = "table" | "field" | "record" | "view" | "form" | "dashboard";

export type TemplateRef = {
  $ref: TemplateRefKind;
  key: string;
};

export type TemplateFormulaExpression = {
  $formula: Array<string | TemplateRef>;
};

export type TemplateValue =
  | string
  | number
  | boolean
  | null
  | TemplateRef
  | TemplateFormulaExpression
  | TemplateValue[]
  | { [key: string]: TemplateValue };

export type TemplateField = {
  key: string;
  name: string;
  type: string;
  description?: string | null;
  icon?: string | null;
  config?: Record<string, unknown>;
  required?: boolean;
  presentable?: boolean;
  hideInTable?: boolean;
  defaultValue?: unknown;
  indexed?: boolean;
  uniqueConstraint?: boolean;
};

export type TemplateTable = {
  key: string;
  name: string;
  description?: string | null;
  fields: TemplateField[];
};

export type TemplateRecord = {
  key: string;
  table: string;
  values: Record<string, unknown>;
};

export type TemplateView = {
  key: string;
  table: string;
  name: string;
  query?: unknown;
  shared?: boolean;
};

export type TemplateForm = {
  key: string;
  table: string;
  name: string;
  isPublic?: boolean;
  config: Record<string, unknown>;
};

export type TemplateDashboard = {
  key: string;
  name: string;
  description?: string | null;
  shared?: boolean;
  config: unknown;
};

export type GridTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  baseName: string;
  baseDescription?: string | null;
  tables: TemplateTable[];
  records?: TemplateRecord[];
  views?: TemplateView[];
  forms?: TemplateForm[];
  dashboards?: TemplateDashboard[];
  defaultDashboard?: string;
};

export const table = (key: string): TemplateRef => ({ $ref: "table", key });
export const field = (key: string): TemplateRef => ({ $ref: "field", key });
export const record = (key: string): TemplateRef => ({ $ref: "record", key });
export const view = (key: string): TemplateRef => ({ $ref: "view", key });
export const form = (key: string): TemplateRef => ({ $ref: "form", key });
export const dashboard = (key: string): TemplateRef => ({ $ref: "dashboard", key });
export const formula = (...parts: Array<string | TemplateRef>): TemplateFormulaExpression => ({ $formula: parts });
