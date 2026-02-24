import { createCloud } from "@valentinkolb/cloud-core";
import type { CreateCloudOptions, CreateCloudResult } from "@valentinkolb/cloud-core";
import type { AppFacade } from "@valentinkolb/cloud-contracts/app";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuiltInApps } from "./built-in-apps";
import { resolveRuntimeOptions } from "./runtime-options";

const standaloneRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type StandaloneOptions = {
  apps?: readonly AppFacade[];
  disabledApps?: readonly string[];
  coreOptions?: CreateCloudOptions["coreOptions"];
};

/**
 * Creates a standalone cloud instance with all built-in apps by default.
 */
export const createStandaloneCloud = async (options: StandaloneOptions = {}): Promise<CreateCloudResult> => {
  const runtimeOptions = resolveRuntimeOptions();
  const { apps: defaultApps, skippedAppIds } = resolveBuiltInApps(options.disabledApps ?? runtimeOptions.disabledApps);
  const coreOptions = {
    staticRoot: standaloneRoot,
    brandingPublicDir: resolve(standaloneRoot, "public"),
    ...options.coreOptions,
  };

  const cloud = await createCloud({
    apps: options.apps ?? defaultApps,
    coreOptions,
  });

  if (!options.apps && skippedAppIds.length > 0) {
    const { logger } = await import("@valentinkolb/cloud-core/services/logging");
    logger("standalone").info("Skipped disabled apps", {
      apps: skippedAppIds,
    });
  }

  return cloud;
};

/**
 * Boots standalone mode and returns Bun's server export object.
 */
export const serveCloudStandalone = async (options: StandaloneOptions = {}) => {
  const cloud = await createStandaloneCloud(options);
  return cloud.serve();
};

export default serveCloudStandalone;
