import { describe, expect, test } from "bun:test";
import { venueHelp } from ".";

describe("venueHelp", () => {
  test("serves the existing Venue help topics as Markdown", async () => {
    expect(venueHelp.documents.map((document) => document.id)).toEqual(["venue-start", "venue-work", "venue-troubleshooting"]);
    expect(venueHelp.getMarkdown("venue-start")).toContain("Venues manages staffed places");
    expect(venueHelp.getMarkdown("venue-work")).toContain("The venue workspace separates daily staffing");
    expect(venueHelp.getMarkdown("venue-troubleshooting")).toContain("The public page shows the wrong opening status");
  });
});
