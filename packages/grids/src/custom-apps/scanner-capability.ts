import { createHash } from "node:crypto";
import type { GridsWorkflowLauncherConfig } from "../workflows/contracts";

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
};

export const customAppScannerConfigHash = (config: Extract<GridsWorkflowLauncherConfig, { kind: "scanner" }>): string =>
  createHash("sha256")
    .update("grids.custom-app.scanner.v1\0")
    .update(JSON.stringify(stableValue(config)))
    .digest("hex");
