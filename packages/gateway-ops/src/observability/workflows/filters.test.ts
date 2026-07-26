import { describe, expect, test } from "bun:test";
import { workflowsFilter } from "./filters";

const parse = (query: string) => workflowsFilter.parse(new URL(`http://cloud/admin/observability/workflows${query}`));

describe("workflow observability URL state", () => {
  test("defaults to the run list", () => {
    expect(parse("")).toEqual({
      view: "runs",
      app: "",
      state: "all",
      mode: "all",
      window: "24h",
      run: "",
      parent: "",
      page: 1,
    });
  });

  test("round-trips an operator queue and pagination", () => {
    const state = parse("?view=effects&app=mail&page=3");
    expect(workflowsFilter.parse(new URL(`http://cloud${workflowsFilter.build(state)}`))).toEqual(state);
  });

  test("keeps parent navigation shareable and rejects unknown views", () => {
    expect(parse("?parent=5de41b38-a3ac-47f3-b47c-da6472afbb42").parent).toBe("5de41b38-a3ac-47f3-b47c-da6472afbb42");
    expect(parse("?view=unknown").view).toBe("runs");
    expect(parse("?run=not-a-uuid&parent=also-invalid")).toMatchObject({ run: "", parent: "" });
  });
});
