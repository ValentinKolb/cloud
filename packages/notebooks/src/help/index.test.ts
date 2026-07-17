import { describe, expect, test } from "bun:test";
import { notebookHelp } from ".";

const expectedIds = [
  "notebooks-start",
  "notebooks-core-model",
  "notebooks-write-organize",
  "notebooks-structured-blocks",
  "notebooks-table-formulas",
  "notebooks-scripts",
  "notebooks-script-api",
  "notebooks-settings-access",
  "notebooks-troubleshooting",
];

describe("notebookHelp", () => {
  test("keeps the reviewed topic order explicit", () => {
    expect(notebookHelp.manifest.map((document) => document.id)).toEqual(expectedIds);
    for (const id of expectedIds) expect(notebookHelp.getMarkdown(id)?.length).toBeGreaterThan(20);
  });

  test("distinguishes guided steps from reference paths", async () => {
    const response = await notebookHelp.router.request("/notebooks-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.html).toContain("<ol ");
    expect(payload.html).toContain("<strong>Write:</strong>");
    expect(payload.html).toContain("<ul ");
    expect(payload.html).toContain("<strong>Capture notes:</strong>");
  });

  test("serves trusted-script guidance as inert documentation", async () => {
    const response = await notebookHelp.router.request("/notebooks-scripts");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Scripts are trusted JavaScript blocks for small notebook apps.");
    expect(payload.markdown).toContain("Script blocks run in the browser of users who open the note.");
    expect(payload.html).not.toContain("data-script-source");
    expect(payload.html).toContain('<span class="hl-keyword">const</span>');
  });

  test("renders API and formula references as scannable tables", async () => {
    const scriptResponse = await notebookHelp.router.request("/notebooks-script-api");
    const scriptPayload = await scriptResponse.json();
    const formulaResponse = await notebookHelp.router.request("/notebooks-table-formulas");
    const formulaPayload = await formulaResponse.json();

    expect(scriptResponse.status).toBe(200);
    expect(scriptPayload.html).toContain("<h4>Current metadata</h4>");
    expect(scriptPayload.html).toContain('<div class="md-table-wrap">');
    expect(scriptPayload.html).toContain(">What it does</span>");
    expect(scriptPayload.html).toContain(">await current.setContent(markdown)</code>");
    expect(scriptPayload.html).toContain(">string | null</code>");
    expect(scriptPayload.html).toContain(">Lock timestamp, or null when the note is not locked.</span>");
    expect(scriptPayload.html).not.toContain("<h5><code");

    expect(formulaResponse.status).toBe(200);
    expect(formulaPayload.html).toContain("<h4>Progress and percentages</h4>");
    expect(formulaPayload.html).toContain('<div class="md-table-wrap">');
    expect(formulaPayload.html).toContain(">Result and notes</span>");
    expect(formulaPayload.html).toContain(">PROGRESS</code></span>");
  });
});
