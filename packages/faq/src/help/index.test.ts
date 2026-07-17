import { describe, expect, test } from "bun:test";
import { faqHelp } from ".";

describe("faqHelp", () => {
  test("serves the existing FAQ help as Markdown", async () => {
    expect(faqHelp.manifest.map((document) => document.id)).toEqual(["faq-start"]);

    const response = await faqHelp.router.request("/faq-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("FAQ publishes short help entries");
    expect(payload.markdown).toContain("Logged-out visitors see anonymous entries.");
  });
});
