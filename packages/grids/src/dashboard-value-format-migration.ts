type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

const legacyValueFormat = (format: unknown): JsonObject | undefined => {
  if (format === "integer") return { style: "integer" };
  if (format === "percent") return { style: "percent" };
  if (format === "currency") {
    return { style: "number", decimalPlaces: 2, unit: "EUR", unitPosition: "suffix" };
  }
  if (format === "plain") return { style: "number" };
  return undefined;
};

const migrateWidget = (value: unknown): unknown => {
  if (!isObject(value) || (value.kind !== "stat" && value.kind !== "chart") || !("format" in value)) return value;

  const migrated = { ...value };
  const valueFormat = legacyValueFormat(migrated.format);
  delete migrated.format;
  if (migrated.valueFormat === undefined && valueFormat !== undefined) migrated.valueFormat = valueFormat;
  return migrated;
};

const migrateRow = (value: unknown): unknown => {
  if (!isObject(value) || !Array.isArray(value.cells)) return value;
  const originalCells = value.cells;
  const cells = originalCells.map(migrateWidget);
  return cells.some((cell, index) => cell !== originalCells[index]) ? { ...value, cells } : value;
};

/** One-way migration for dashboard JSON persisted before valueFormat. */
export const migrateDashboardValueFormats = (value: unknown): unknown => {
  if (!isObject(value) || !Array.isArray(value.rows)) return value;
  const originalRows = value.rows;
  const rows = originalRows.map(migrateRow);
  return rows.some((row, index) => row !== originalRows[index]) ? { ...value, rows } : value;
};
