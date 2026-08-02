import { describe, expect, test } from "bun:test";
import { faqHelp } from ".";

describe("faqHelp", () => {
  test("owns the existing FAQ help as Markdown", () => {
    expect(faqHelp.documents.map((document) => document.id)).toEqual(["faq-start", "faq-admin"]);

    expect(faqHelp.getMarkdown("faq-start")).toContain("FAQ publishes short answers");
    expect(faqHelp.getMarkdown("faq-start")).toContain("Logged-out visitors see anonymous entries.");
    expect(faqHelp.getMarkdown("faq-admin")).toContain("Use the user's wording for the question");
  });
});
