import { describe, expect, test } from "bun:test";
import { generateSpecs } from "hono-openapi";
import app from ".";

const base = "/mailboxes/{mailboxId}/conversations/{conversationId}";

describe("Mail conversation context OpenAPI contract", () => {
  test("publishes authenticated Contacts context and history routes", async () => {
    const spec = await generateSpecs(app);
    const operations = [spec.paths?.[`${base}/context`]?.get, spec.paths?.[`${base}/contacts/{bookId}/{contactId}/history`]?.get];

    expect(operations.every((operation) => operation?.tags?.includes("Mail:Context"))).toBe(true);
    expect(operations.every((operation) => operation?.security?.length === 1)).toBe(true);
    expect(operations.every((operation) => operation?.responses?.["200"])).toBe(true);
  });
});
