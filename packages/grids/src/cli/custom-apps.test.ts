import { describe, expect, test } from "bun:test";
import { customAppCommands } from "./custom-apps";

describe("Custom App CLI", () => {
  test("exposes one deterministic lifecycle without legacy aliases", () => {
    expect(customAppCommands.map((item) => item.path.join(" "))).toEqual([
      "apps reference",
      "apps list",
      "apps get",
      "apps validate",
      "apps plan",
      "apps apply",
      "apps export",
      "apps publish",
    ]);
  });

  test("requires an explicit definition source and publish confirmation", () => {
    for (const path of ["apps validate", "apps plan", "apps apply"]) {
      const item = customAppCommands.find((command) => command.path.join(" ") === path);
      expect(item?.flags?.source).toMatchObject({ kind: "input", required: true, fileName: "source-file", stdinName: "stdin" });
    }
    const publish = customAppCommands.find((command) => command.path.join(" ") === "apps publish");
    expect(publish?.flags?.yes).toMatchObject({ kind: "boolean", name: "yes" });
  });
});
