/**
 * Cloud-owned access controls that depend on Cloud principals, permissions,
 * and resource API-key contracts.
 *
 * Portable controls belong in `@k2b/ui`; this focused boundary keeps apps
 * from depending on Cloud's broad legacy UI entrypoint.
 */
export { default as PermissionEditor } from "../ui/misc/PermissionEditor";
export type { AllowedLevel, GrantableLevel } from "../ui/misc/PermissionEditor";
export { default as ResourceApiKeys } from "../ui/misc/ResourceApiKeys";
export type {
  ResourceApiKey,
  ResourceApiKeyPermissionOption,
  ResourceApiKeysProps,
} from "../ui/misc/ResourceApiKeys";
