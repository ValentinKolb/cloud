import { describe, expect, test } from "bun:test";
import { generateSpecs } from "hono-openapi";
import app from ".";

describe("Contacts Mail integration OpenAPI contract", () => {
  test("publishes the authenticated minimal participant resolver", async () => {
    const spec = await generateSpecs(app);
    const operation = spec.paths?.["/integrations/mail/resolve-participants"]?.post;

    expect(operation?.summary).toBe("Resolve readable contacts for Mail participants");
    expect(operation?.security).toEqual([{ cookieAuth: [], bearerAuth: [] }]);
    expect(Object.keys(operation?.responses ?? {})).toEqual(["200", "400", "403"]);
    expect(operation?.requestBody).toBeDefined();
  });
});
