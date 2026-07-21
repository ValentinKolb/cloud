import { describe, expect, test } from "bun:test";
import { generateSpecs } from "hono-openapi";
import app from ".";

describe("Spaces Mail integration OpenAPI contract", () => {
  test("publishes authenticated resolve and candidate endpoints", async () => {
    const spec = await generateSpecs(app);
    const resolve = spec.paths?.["/integrations/mail/resolve"]?.post;
    const candidates = spec.paths?.["/integrations/mail/candidates"]?.get;

    expect(resolve?.summary).toBe("Resolve readable Spaces for Mail");
    expect(resolve?.security).toEqual([{ cookieAuth: [], bearerAuth: [] }]);
    expect(resolve?.requestBody).toBeDefined();
    expect(candidates?.summary).toBe("List readable Space candidates for Mail");
    expect(candidates?.security).toEqual([{ cookieAuth: [], bearerAuth: [] }]);
    expect(candidates?.parameters).toBeDefined();
  });
});
