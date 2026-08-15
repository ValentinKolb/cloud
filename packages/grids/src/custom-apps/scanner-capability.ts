import { createHash } from "node:crypto";
import type { GridsWorkflowLauncherConfig } from "../workflows/contracts";
import { stableCustomAppValue } from "./stable-value";

export const customAppScannerConfigHash = (config: Extract<GridsWorkflowLauncherConfig, { kind: "scanner" }>): string =>
  createHash("sha256")
    .update("grids.custom-app.scanner.v1\0")
    .update(JSON.stringify(stableCustomAppValue(config)))
    .digest("hex");
