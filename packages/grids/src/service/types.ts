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
  type: string;
  config: Record<string, unknown>;
  position: number;
  required: boolean;
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
  type: string;
  config?: Record<string, unknown>;
  position?: number;
  required?: boolean;
  defaultValue?: unknown;
  indexed?: boolean;
  uniqueConstraint?: boolean;
};

export type UpdateFieldInput = {
  name?: string;
  config?: Record<string, unknown>;
  position?: number;
  required?: boolean;
  defaultValue?: unknown;
  indexed?: boolean;
  uniqueConstraint?: boolean;
};
