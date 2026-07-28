import { parse, stringify } from "yaml";
import { migrateWorkflowTextTemplateToLiquid } from "../service/template-rendering";

const TEMPLATE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  addComment: ["body"],
  automaticReply: ["subject", "body"],
  createDraft: ["subject", "body"],
  fail: ["message"],
  notifyUser: ["title", "body"],
  succeed: ["message"],
};

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

const migrateValue = (value: unknown): number => {
  if (Array.isArray(value)) return value.reduce((count, item) => count + migrateValue(item), 0);
  if (!isObject(value)) return 0;
  let migrated = 0;
  for (const [action, fields] of Object.entries(TEMPLATE_FIELDS)) {
    const config = value[action];
    if (!isObject(config)) continue;
    for (const field of fields) {
      const current = config[field];
      if (typeof current !== "string") continue;
      const next = migrateWorkflowTextTemplateToLiquid(current);
      if (next === current) continue;
      config[field] = next;
      migrated += 1;
    }
  }
  for (const child of Object.values(value)) migrated += migrateValue(child);
  return migrated;
};

export const migrateMailWorkflowSourceToLiquid = (source: string): { source: string; migratedTemplates: number } => {
  const document = parse(source) as unknown;
  if (!isObject(document)) throw new Error("Cannot migrate a non-object Mail workflow source");
  const migratedTemplates = migrateValue(document);
  return {
    source: migratedTemplates > 0 ? stringify(document, { lineWidth: 0 }) : source,
    migratedTemplates,
  };
};
