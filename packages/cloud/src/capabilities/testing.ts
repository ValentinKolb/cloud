import { capabilityManifestEvolutionIssues, compileCapabilities } from "../_internal/capabilities";
import type { CapabilityDefinitions, CapabilityManifest } from "../contracts/capabilities";

/** Compile and validate the public manifest an app would register at startup. */
export const compileCapabilityManifest = (appId: string, definitions: CapabilityDefinitions): CapabilityManifest =>
  compileCapabilities(appId, definitions).manifest;

/** Fail a provider compatibility test when a published local id changed incompatibly. */
export const assertCapabilityManifestEvolution = (previous: CapabilityManifest, next: CapabilityManifest): void => {
  const issues = capabilityManifestEvolutionIssues(previous, next);
  if (issues.length > 0) throw new Error(`Breaking Capability manifest evolution:\n- ${issues.join("\n- ")}`);
};
