import { describe, expect, test } from "bun:test";
import { ReorderFaqSchema, UpdateFaqSchema } from "./contracts";

describe("FAQ contracts", () => {
  test("rejects empty update payloads", () => {
    expect(UpdateFaqSchema.safeParse({}).success).toBe(false);
  });

  test("accepts partial update payloads", () => {
    expect(UpdateFaqSchema.safeParse({ question: "How do I sign in?" }).success).toBe(true);
  });

  test("rejects duplicate reorder ids", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(ReorderFaqSchema.safeParse({ ids: [id, id] }).success).toBe(false);
  });
});
