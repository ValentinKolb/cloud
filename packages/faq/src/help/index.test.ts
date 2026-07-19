import { describe, expect, test } from "bun:test";
import { faqHelp } from ".";

describe("faqHelp", () => {
  test("serves the existing FAQ help as Markdown", async () => {
    expect(faqHelp.manifest.map((document) => document.id)).toEqual(["faq-start", "faq-admin"]);

    const response = await faqHelp.router.request("/faq-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("FAQ publishes short answers");
    expect(payload.markdown).toContain("Logged-out visitors see anonymous entries.");

    const adminResponse = await faqHelp.router.request("/faq-admin");
    const adminPayload = await adminResponse.json();
    expect(adminPayload.markdown).toContain("Use the user's wording for the question");
  });
});
