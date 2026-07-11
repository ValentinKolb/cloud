import type { PermissionLevel, ServiceAccountCredential } from "@valentinkolb/cloud/contracts";

export type MessageResult = { message: string };
export type PulseSourceApiKey = ServiceAccountCredential & { permission: PermissionLevel };
export type SourceApiKeyCreateResult = { credential: PulseSourceApiKey; token: string };
