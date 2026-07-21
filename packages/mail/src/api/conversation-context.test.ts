import { describe, expect, test } from "bun:test";
import { generateSpecs } from "hono-openapi";
import app from ".";

const base = "/mailboxes/{mailboxId}/conversations/{conversationId}";

describe("Mail conversation context OpenAPI contract", () => {
  test("publishes context, history, candidates, and revisioned link mutations", async () => {
    const spec = await generateSpecs(app);
    const operations = [
      spec.paths?.[`${base}/context`]?.get,
      spec.paths?.[`${base}/contacts/{bookId}/{contactId}/history`]?.get,
      spec.paths?.[`${base}/spaces/candidates`]?.get,
      spec.paths?.[`${base}/spaces`]?.post,
      spec.paths?.[`${base}/spaces/{linkId}`]?.delete,
    ];

    expect(operations.every((operation) => operation?.tags?.includes("Mail:Context"))).toBe(true);
    expect(operations.every((operation) => operation?.security?.length === 1)).toBe(true);
    expect(operations.every((operation) => operation?.responses?.["200"])).toBe(true);
    expect(operations[3]?.requestBody).toBeDefined();
    expect(operations[4]?.requestBody).toBeDefined();
  });
});
