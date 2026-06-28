import { describe, expect, test } from "bun:test";
import { readDashboardControlQueryState } from "./routes";

describe("Pulse workspace routes", () => {
  test("reads dashboard control values without trimming or dropping empty overrides", () => {
    expect(readDashboardControlQueryState("?c_range=24h&c_search=&q=ignored&c_label=hello%20world")).toEqual({
      range: "24h",
      search: "",
      label: "hello world",
    });
  });
});
