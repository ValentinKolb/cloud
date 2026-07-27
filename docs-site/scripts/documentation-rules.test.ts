import { describe, expect, test } from "bun:test";
import { headingContractErrors, metadataErrors } from "./documentation-rules";

const validMeta = {
  title: "Page",
  navTitle: "Page",
  section: "Start",
  order: "10",
  description: "A page.",
  tags: "[docs, api]",
  updated: "2026-07-27",
};

describe("documentation metadata", () => {
  test("accepts the canonical frontmatter shape", () => {
    expect(metadataErrors(validMeta)).toEqual([]);
  });

  test("rejects zero order, empty tags, and invalid dates", () => {
    expect(
      metadataErrors({
        ...validMeta,
        order: "0",
        tags: "[]",
        updated: "2026-02-30",
      }),
    ).toEqual(["order must be a positive integer", "tags must be a non-empty inline list", "updated must be a valid YYYY-MM-DD date"]);
  });
});

describe("documentation headings", () => {
  test("requires exactly one leading H1", () => {
    expect(headingContractErrors("# Page\n\n## Detail", "Page")).toEqual([]);
    expect(headingContractErrors("## Detail\n\n# Page", "Page")).toContain("H1 must be the first heading");
    expect(headingContractErrors("# Page\n\n# Again", "Page")).toContain("must contain exactly one H1");
  });
});
