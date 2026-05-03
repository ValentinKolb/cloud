export type Base = {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Table = {
  id: string;
  baseId: string;
  name: string;
  description: string | null;
  primaryFieldId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type Field = {
  id: string;
  tableId: string;
  name: string;
  /** Optional helper text shown beside the field in the edit modal and
   *  detail panel. Top-level (not in config) since it's metadata, not
   *  type-specific configuration. */
  description: string | null;
  type: string;
  config: Record<string, unknown>;
  position: number;
  required: boolean;
  /** When true, the field appears in the auto-generated label whenever
   *  this record is referenced elsewhere (relation cells, picker
   *  labels). Multiple presentable fields are joined with " · ". */
  presentable: boolean;
  /** When true, the field is hidden from the default records grid by
   *  default; still rendered in the record detail panel. Views can
   *  override via `view.config.columns`. */
  hideInTable: boolean;
  defaultValue: unknown;
  indexed: boolean;
  uniqueConstraint: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GridRecord = {
  id: string;
  tableId: string;
  data: Record<string, unknown>;
  version: number;
  deletedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuditAction = "created" | "updated" | "deleted" | "restored" | "imported";

export type AuditEntry = {
  id: string;
  baseId: string | null;
  tableId: string | null;
  recordId: string | null;
  userId: string | null;
  action: AuditAction;
  diff: Record<string, { old: unknown; new: unknown }> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type CreateBaseInput = { name: string; description?: string | null };
export type UpdateBaseInput = { name?: string; description?: string | null };

export type CreateTableInput = { baseId: string; name: string; description?: string | null };
export type UpdateTableInput = { name?: string; description?: string | null; primaryFieldId?: string | null };

export type CreateFieldInput = {
  tableId: string;
  name: string;
  description?: string | null;
  type: string;
  config?: Record<string, unknown>;
  position?: number;
  required?: boolean;
  presentable?: boolean;
  hideInTable?: boolean;
  defaultValue?: unknown;
  indexed?: boolean;
  uniqueConstraint?: boolean;
};

export type UpdateFieldInput = {
  name?: string;
  description?: string | null;
  config?: Record<string, unknown>;
  position?: number;
  required?: boolean;
  presentable?: boolean;
  hideInTable?: boolean;
  defaultValue?: unknown;
  indexed?: boolean;
  uniqueConstraint?: boolean;
};
