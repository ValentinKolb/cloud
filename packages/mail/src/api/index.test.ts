import { describe, expect, test } from "bun:test";
import api from "./index";

describe("Mail API composition", () => {
  test("scopes the platform-admin guard to admin routes", () => {
    const adminGuard = api.routes.find((route) => route.method === "ALL" && route.path === "/admin/*");
    const mailboxRoute = api.routes.find((route) => route.method === "GET" && route.path === "/mailboxes");

    expect(adminGuard).toBeDefined();
    expect(mailboxRoute).toBeDefined();
  });

  test("exposes mailbox-scoped subscription routes", () => {
    expect(api.routes.some((route) => route.method === "GET" && route.path === "/mailboxes/:mailboxId/subscriptions")).toBe(true);
    expect(api.routes.some((route) => route.method === "POST" && route.path === "/mailboxes/:mailboxId/subscriptions/unsubscribe")).toBe(
      true,
    );
    expect(api.routes.some((route) => route.method === "POST" && route.path === "/mailboxes/:mailboxId/subscriptions/disposition")).toBe(
      true,
    );
  });

  test("exposes sender preview and durable existing-message backfill routes", () => {
    expect(api.routes.some((route) => route.method === "GET" && route.path === "/mailboxes/:mailboxId/sender-rules/:ruleId")).toBe(true);
    expect(api.routes.some((route) => route.method === "GET" && route.path === "/mailboxes/:mailboxId/sender-rules/catalog")).toBe(true);
    for (const path of [
      "/mailboxes/:mailboxId/sender-rules/preview",
      "/mailboxes/:mailboxId/sender-rules/mark-read",
      "/mailboxes/:mailboxId/sender-rules/:ruleId/backfills",
    ]) {
      expect(api.routes.some((route) => route.method === "POST" && route.path === path)).toBe(true);
    }
    for (const method of ["GET", "DELETE"]) {
      expect(
        api.routes.some(
          (route) => route.method === method && route.path === "/mailboxes/:mailboxId/sender-rules/:ruleId/backfills/:operationId",
        ),
      ).toBe(true);
    }
  });

  test("exposes an explicit mailbox-scoped provider limit refresh", () => {
    expect(
      api.routes.some(
        (route) => route.method === "POST" && route.path === "/mailboxes/:mailboxId/connections/:connectionId/limits/refresh",
      ),
    ).toBe(true);
  });
});
