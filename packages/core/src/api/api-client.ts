import { api } from "@valentinkolb/cloud-lib/browser";

/**
 * Browser-safe client for core API routes.
 * Keep this file free of server route imports to avoid Bun-runtime modules in browser bundles.
 */
export const apiClient: any = api.create({ baseUrl: "/api" });
