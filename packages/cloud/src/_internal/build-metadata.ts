import type { AppRuntimeMetadata } from "../contracts/registry";

declare const __CLOUD_RELEASE__: string;
declare const __CLOUD_SYNC_VERSION__: string;

export const appRuntimeMetadata: AppRuntimeMetadata = {
  release: typeof __CLOUD_RELEASE__ === "string" ? __CLOUD_RELEASE__ : "development",
  syncVersion: typeof __CLOUD_SYNC_VERSION__ === "string" ? __CLOUD_SYNC_VERSION__ : "unknown",
};
