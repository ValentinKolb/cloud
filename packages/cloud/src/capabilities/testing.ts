import { compileCapabilities } from "../_internal/capabilities";
import type { CapabilityDefinitions, CapabilityManifest } from "../contracts/capabilities";

/** Compile and validate the public manifest an app would register at startup. */
export const compileCapabilityManifest = (appId: string, definitions: CapabilityDefinitions): CapabilityManifest =>
  compileCapabilities(appId, definitions).manifest;
