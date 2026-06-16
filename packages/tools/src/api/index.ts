import { type AuthContext, rateLimit } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import speedtestRoutes from "./speedtest";
import speedtestCliRoutes from "./speedtest-cli";
import webhookRoutes from "./webhooks";

const buildToolsApi = () =>
  new Hono<AuthContext>()
    .route("/speedtest", speedtestRoutes)
    .use(rateLimit())
    .route("/speedtest", speedtestCliRoutes)
    .route("/webhooks", webhookRoutes);

export type ApiType = ReturnType<typeof buildToolsApi>;

export const createToolsApiRouter = () => buildToolsApi();
