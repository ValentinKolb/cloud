import { describe, expect, test } from "bun:test";

const { default: contactsPages } = await import("./index");

describe("Contacts frontend routes", () => {
  test("does not retain the removed book settings route", async () => {
    const response = await contactsPages.request("/book-1/settings");
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});
