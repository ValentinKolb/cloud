import { Hono } from "hono";
import { Scalar } from "@scalar/hono-api-reference";
import { generateSpecs } from "hono-openapi";
import { prettyJSON } from "hono/pretty-json";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";
import authRoutes from "@/api/auth";
import meRoutes from "@/api/me";
import { openApiMeta } from "@valentinkolb/cloud-lib/server/middleware/openapi";
import type { AppFacade } from "@valentinkolb/cloud-contracts/app";

/**
 * Builds the API router and OpenAPI assets for a specific app set.
 */
export const createApiRouter = async (apps: readonly AppFacade[]) => {
  const api = new Hono().use(prettyJSON());

  // App APIs mounted as absolute paths under /api
  for (const app of apps) {
    if (!app.routes.api) continue;
    api.route("/", app.routes.api);
  }

  // Individual routes
  api.route("/auth", authRoutes);
  api.route("/me", meRoutes);

  const spec = await generateSpecs(api, openApiMeta);
  const llmsTxt = await createMarkdownFromOpenApi(JSON.stringify(spec));

  // OpenAPI documentation routes
  api.get("/openapi.json", (c) => c.json(spec));
  api.get(
    "/docs",
    Scalar({
      theme: "saturn",
      url: "/api/openapi.json",
      hideClientButton: true,
    }),
  );

  // Catch-all for unknown API routes (must be after all other routes)
  api.all("/*", (c) => c.json({ message: "API route not found" }, 404));

  return { api, llmsTxt };
};
