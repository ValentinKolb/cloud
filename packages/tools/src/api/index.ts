import { Hono } from "hono";
import speedtestRoutes from "./speedtest";
import speedtestCliRoutes from "./speedtest-cli";
import webhookRoutes from "./webhooks";

const buildToolsApi = () =>
  new Hono().route("/speedtest", speedtestRoutes).route("/speedtest", speedtestCliRoutes).route("/webhooks", webhookRoutes);

export type ApiType = ReturnType<typeof buildToolsApi>;

export const createToolsApiRouter = () => buildToolsApi();
