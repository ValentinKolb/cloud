import type { RecordSnapshot } from "../../../contracts";
import type { Field, GridRecord } from "../../../service";

type SnapshotField = Partial<Field> & {
  id?: unknown;
  shortId?: unknown;
  name?: unknown;
  type?: unknown;
  config?: unknown;
};

export type SnapshotRecordNode = {
  id?: unknown;
  table?: unknown;
  fields?: unknown;
  data?: unknown;
  version?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
};

const snapshotObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export const snapshotTableName = (snapshot: RecordSnapshot): string => {
  const table = snapshotObject(snapshotObject(snapshot.root).table);
  return typeof table.name === "string" && table.name.trim() ? table.name : "Snapshot record";
};

const normalizeSnapshotField = (field: SnapshotField, tableId: string, index: number): Field | null => {
  if (typeof field.id !== "string" || typeof field.name !== "string" || typeof field.type !== "string") return null;
  return {
    id: field.id,
    shortId: typeof field.shortId === "string" ? field.shortId : field.id.slice(0, 5),
    tableId,
    name: field.name,
    description: typeof field.description === "string" ? field.description : null,
    icon: typeof field.icon === "string" ? field.icon : null,
    type: field.type,
    config: snapshotObject(field.config),
    position: typeof field.position === "number" ? field.position : index,
    required: field.required === true,
    presentable: field.presentable === true,
    hideInTable: field.hideInTable === true,
    defaultValue: field.defaultValue,
    indexed: field.indexed === true,
    uniqueConstraint: field.uniqueConstraint === true,
    deletedAt: typeof field.deletedAt === "string" ? field.deletedAt : null,
    createdAt: typeof field.createdAt === "string" ? field.createdAt : "",
    updatedAt: typeof field.updatedAt === "string" ? field.updatedAt : "",
  };
};

export const snapshotFields = (node: SnapshotRecordNode, tableId: string): Field[] =>
  (Array.isArray(node.fields) ? node.fields : [])
    .map((field, index) => normalizeSnapshotField(field as SnapshotField, tableId, index))
    .filter((field): field is Field => Boolean(field));

export const snapshotGridRecord = (snapshot: RecordSnapshot): GridRecord => {
  const root = snapshot.root as SnapshotRecordNode;
  return {
    id: typeof root.id === "string" ? root.id : snapshot.recordId,
    tableId: snapshot.tableId,
    data: snapshotObject(root.data),
    version: typeof root.version === "number" ? root.version : 0,
    deletedAt: typeof root.deletedAt === "string" || root.deletedAt === null ? root.deletedAt : null,
    createdBy: null,
    updatedBy: null,
    createdAt: typeof root.createdAt === "string" ? root.createdAt : snapshot.createdAt,
    updatedAt: typeof root.updatedAt === "string" ? root.updatedAt : snapshot.createdAt,
  };
};

const snapshotNodeLabel = (node: SnapshotRecordNode): string | null => {
  const table = snapshotObject(node.table);
  const fields = snapshotFields(node, typeof table.id === "string" ? table.id : "");
  const data = snapshotObject(node.data);
  const field =
    fields.find((item) => item.presentable && item.id in data) ?? fields.find((item) => item.type === "text" && item.id in data);
  if (field) {
    const value = data[field.id];
    if (typeof value === "string" && value.trim()) return value;
    if (value !== null && value !== undefined && typeof value !== "object") return String(value);
  }
  return typeof node.id === "string" ? node.id.slice(0, 8) : null;
};

export const snapshotRelationLabels = (snapshot: RecordSnapshot): Record<string, string> => {
  const graph = snapshotObject(snapshot.graph);
  const records = snapshotObject(graph.records);
  const labels: Record<string, string> = {};
  for (const value of Object.values(records)) {
    const node = value as SnapshotRecordNode;
    if (typeof node.id !== "string") continue;
    const label = snapshotNodeLabel(node);
    if (label) labels[node.id] = label;
  }
  return labels;
};
