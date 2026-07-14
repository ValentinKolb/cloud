import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { apiRoutes } from "./api";

describe("API Docs source API", () => {
  test("returns the validated live registry catalogue", async () => {
    const app = new Hono()
      .use("*", async (c, next) => {
        (c as unknown as { set: (key: string, value: unknown) => void }).set("runtime", {
          apps: [
            {
              id: "grids",
              name: "Grids",
              description: "Structured data.",
              openapi: "/api/grids/openapi.json",
            },
            { id: "unsafe", name: "Unsafe", description: "", openapi: "file:///tmp/spec.json" },
          ],
        });
        await next();
      })
      .route("/", apiRoutes);

    const response = await app.request("/sources");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id: "grids",
          name: "Grids",
          description: "Structured data.",
          url: "/api/grids/openapi.json",
        },
      ],
    });
  });
});
