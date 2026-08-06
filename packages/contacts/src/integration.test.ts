import { describe, expect, test } from "bun:test";
import { buildContactCreateHref, parseContactCreateSeed } from "./integration";

describe("Contacts create link", () => {
  test("builds and parses bounded contact create links", () => {
    const href = buildContactCreateHref({ email: " ADA@Example.COM ", name: " Ada Example " });
    const url = new URL(href, "https://cloud.example");

    expect(url.pathname).toBe("/app/contacts");
    expect(parseContactCreateSeed(url.searchParams)).toEqual({ email: "ada@example.com", name: "Ada Example" });
    expect(parseContactCreateSeed(new URLSearchParams("createContact=1&email=invalid"))).toBeNull();
    expect(parseContactCreateSeed(new URLSearchParams("email=ada@example.com"))).toBeNull();
  });
});
