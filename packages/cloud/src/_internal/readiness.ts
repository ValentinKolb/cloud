export const APP_READINESS_PATH = "/_cloud/ready";

export const appReadinessResponse = (appId: string): Response => Response.json({ status: "ready", appId });
