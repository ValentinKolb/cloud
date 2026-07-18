import { describe, expect, test } from "bun:test";
import { GQL_EXAMPLES } from "../../../help/gql-examples";
import { parseGridsQueryDsl } from "../../../query-dsl/parser";

describe("Grids GQL reference examples", () => {
  test("copyable GQL examples parse with the public parser", () => {
    expect(GQL_EXAMPLES.length).toBeGreaterThan(0);

    for (const example of GQL_EXAMPLES) {
      const result = parseGridsQueryDsl(example.code);
      expect(result.ok, `${example.title}\n${example.code}`).toBe(true);
    }
  });

  test("copyable GQL examples avoid removed public syntax", () => {
    for (const example of GQL_EXAMPLES) {
      expect(example.code, example.title).not.toMatch(/(^|\s)skip\s/i);
      expect(example.code, example.title).not.toMatch(/\bsort\s+[^;\n]+?\s+(?:ascending|descending)\b/i);
      expect(example.code, example.title).not.toMatch(/(^|[^A-Za-z0-9_])#[A-Za-z0-9_-]+/);
      expect(example.code, example.title).not.toMatch(/\b(?:AND|OR|NOT)\s*\(/);
    }
  });
});
