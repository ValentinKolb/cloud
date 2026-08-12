import { describe, expect, test } from "bun:test";
import resourceRoutes from "./resources";

describe("Mail resource API composition", () => {
  test("resolves the mailbox once for all composite resource routes", () => {
    expect(resourceRoutes.routes.filter((route) => route.method === "ALL" && route.path === "/mailboxes/:mailboxId/*")).toHaveLength(1);
  });
});
