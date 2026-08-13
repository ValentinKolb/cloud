import { expect, test } from "bun:test";
import { customAppCardFileUrl } from "./records-card-url";

test("App card file URLs preserve page context without browser globals", () => {
  expect(
    customAppCardFileUrl("/api/grids/apps/runtime/APP01/home/projects/records?project_id=one&q=alpha&cursor=page-two", "signed/token"),
  ).toBe("/api/grids/apps/runtime/APP01/home/projects/files/signed%2Ftoken?project_id=one");
});
