import { Hono } from "hono";
import { serveStatic, websocket } from "hono/bun";
import { routes } from "@valentinkolb/ssr/hono";
import { logger } from "hono/logger";
import { config } from "@config";
import { env } from "@valentinkolb/cloud-core/config";
import { requestLogger } from "@valentinkolb/cloud-lib/server/middleware/request-logger";
import { logger as appLogger } from "@valentinkolb/cloud-core/services/logging";
import { createApiRouter } from "@/api";
import { createPagesRouter } from "@/pages/create";
import { bootRuntime, createRuntimeContext, validateApps } from "@/runtime";
import type { AppFacade } from "@valentinkolb/cloud-contracts/app";

export type CreateCloudOptions = {
  apps: readonly AppFacade[];
  coreOptions?: {
    skipSetup?: boolean;
    port?: number;
    shutdownTimeoutMs?: number;
    staticRoot?: string;
    brandingPublicDir?: string;
  };
};

export type CreateCloudResult = {
  app: Hono<any>;
  api: Hono<any>;
  llmsTxt: string;
  serve: () => {
    port: number;
    fetch: Hono<any>["fetch"];
    websocket: typeof websocket;
    development: boolean;
  };
};

/**
 * Creates and boots the cloud runtime (setup, lifecycle start, routes, shutdown hooks).
 */
export const createCloud = async (options: CreateCloudOptions): Promise<CreateCloudResult> => {
  const log = appLogger("http");
  const skipSetup = options.coreOptions?.skipSetup ?? false;
  const runtime = createRuntimeContext(options.apps);

  const staticRoot = options.coreOptions?.staticRoot ?? "./";
  const brandingPublicDir = options.coreOptions?.brandingPublicDir ?? "public";

  validateApps(options.apps);

  const wsApp = options.apps
    .filter((appDef) => !!appDef.routes.ws)
    .reduce((router, appDef) => router.route("/", appDef.routes.ws!), new Hono());

  const { api, llmsTxt } = await createApiRouter(options.apps);
  const pages = createPagesRouter(options.apps, { brandingPublicDir });

  const app = new Hono()
    .use("*", async (c, next) => {
      (c as any).set("runtime", runtime);
      await next();
    })
    .use(logger())
    .use(requestLogger)
    .route("/_ssr", routes(config))
    .route("/api", api)
    .route("/ws", wsApp)
    .get("/llms.txt", (c) => c.text(llmsTxt))
    .use(
      "/public/*",
      serveStatic({
        root: staticRoot,
        onFound: (_path, c) => {
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        },
      }),
    )
    .route("/", pages)
    .onError((err, c) => {
      log.error(`Unhandled: ${c.req.method} ${c.req.path}`, {
        error: err.message,
        stack: err.stack,
      });
      return c.text("Internal Server Error", 500);
    });

  await bootRuntime({
    apps: options.apps,
    runtime,
    skipSetup,
    shutdownTimeoutMs: options.coreOptions?.shutdownTimeoutMs,
  });

  return {
    app,
    api,
    llmsTxt,
    serve: () => ({
      port: options.coreOptions?.port ?? parseInt(process.env.PORT ?? "3000", 10),
      fetch: app.fetch,
      websocket,
      development: env.IS_DEVELOPMENT,
    }),
  };
};
