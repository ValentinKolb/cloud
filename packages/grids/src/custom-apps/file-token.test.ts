import { expect, test } from "bun:test";
import { createCustomAppFileToken, verifyCustomAppFileToken } from "./file-token";

const payload = {
  appId: "00000000-0000-4000-8000-000000000001",
  pageId: "catalog",
  blockId: "items",
  tableId: "00000000-0000-4000-8000-000000000002",
  recordId: "00000000-0000-4000-8000-000000000003",
  fieldId: "00000000-0000-4000-8000-000000000004",
  fileId: "00000000-0000-4000-8000-000000000005",
};

test("Custom App file tokens are scoped, signed, and short-lived", () => {
  const token = createCustomAppFileToken(payload, "secret", 1_000);
  expect(verifyCustomAppFileToken(token, "secret", 1_001)).toEqual({ ...payload, expiresAt: 301_000 });
  expect(verifyCustomAppFileToken(token, "other", 1_001)).toBeNull();
  expect(verifyCustomAppFileToken(token, "secret", 301_001)).toBeNull();
  expect(verifyCustomAppFileToken(`${token}x`, "secret", 1_001)).toBeNull();
});
