import type { BunPlugin } from "bun";

const port = parseInt(process.env.PORT ?? "3000", 10);

export const gatewayRouter = {
  id: process.env.GATEWAY_INSTANCE_ID || process.env.HOSTNAME || "gateway-router",
  port,
  baseUrl: `http://gateway:${port}`,
};

export const plugin = (): BunPlugin => ({ name: "gateway-router-noop", setup: () => undefined });
