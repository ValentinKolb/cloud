import { expect, test } from "bun:test";
import { missingExampleImports, packageSpecifiers } from "./check-example-coverage";

test("extracts static and dynamic package imports", () => {
  expect(
    packageSpecifiers(`
      import { defineApp } from "@valentinkolb/cloud";
      const module = import("@k2b/ssr/nav");
    `),
  ).toEqual(new Set(["@valentinkolb/cloud", "@k2b/ssr/nav"]));
});

test("reports documented imports without a compile fixture", () => {
  expect(
    missingExampleImports(
      ["@valentinkolb/cloud", "@valentinkolb/cloud/ai/ui", "@valentinkolb/cloud/src/internal"],
      ["@valentinkolb/cloud"],
    ),
  ).toEqual(["@valentinkolb/cloud/ai/ui"]);
});
