import { describe, expect, test } from "bun:test";
import api from "./index";

describe("Mail API composition", () => {
  test("scopes the platform-admin guard to admin routes", () => {
    const adminGuard = api.routes.find((route) => route.method === "ALL" && route.path === "/admin/*");
    const mailboxRoute = api.routes.find((route) => route.method === "GET" && route.path === "/mailboxes");

    expect(adminGuard).toBeDefined();
    expect(mailboxRoute).toBeDefined();
  });

  test("exposes explicit platform-admin mailbox recovery routes", () => {
    expect(api.routes.some((route) => route.method === "GET" && route.path === "/admin/mailboxes/:mailboxId/operations")).toBe(true);
    expect(api.routes.some((route) => route.method === "GET" && route.path === "/admin/mailboxes/:mailboxId/access")).toBe(true);
    expect(api.routes.some((route) => route.method === "POST" && route.path === "/admin/mailboxes/:mailboxId/access")).toBe(true);
    expect(api.routes.some((route) => route.method === "PATCH" && route.path === "/admin/mailboxes/:mailboxId/access/:accessId")).toBe(
      true,
    );
    expect(api.routes.some((route) => route.method === "DELETE" && route.path === "/admin/mailboxes/:mailboxId/access/:accessId")).toBe(
      true,
    );
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
    expect(api.routes.some((route) => route.method === "GET" && route.path === "/mailboxes/:mailboxId/mail-rules/:ruleId")).toBe(true);
    expect(api.routes.some((route) => route.method === "GET" && route.path === "/mailboxes/:mailboxId/mail-rules/catalog")).toBe(true);
    for (const path of [
      "/mailboxes/:mailboxId/mail-rules/preview",
      "/mailboxes/:mailboxId/mail-rules/mark-read",
      "/mailboxes/:mailboxId/mail-rules/:ruleId/backfills",
    ]) {
      expect(api.routes.some((route) => route.method === "POST" && route.path === path)).toBe(true);
    }
    for (const method of ["GET", "DELETE"]) {
      expect(
        api.routes.some(
          (route) => route.method === method && route.path === "/mailboxes/:mailboxId/mail-rules/:ruleId/backfills/:operationId",
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

  test("exposes the bounded composer calendar facade", () => {
    expect(api.routes.some((route) => route.method === "GET" && route.path === "/mailboxes/:mailboxId/calendar-events")).toBe(true);
    expect(api.routes.some((route) => route.method === "POST" && route.path === "/mailboxes/:mailboxId/calendar-events")).toBe(true);
    expect(
      api.routes.some((route) => route.method === "POST" && route.path === "/mailboxes/:mailboxId/drafts/:draftId/calendar-invitation"),
    ).toBe(true);
  });

  test("exposes user reporting and platform-admin Mail security operations", () => {
    expect(
      api.routes.some((route) => route.method === "POST" && route.path === "/mailboxes/:mailboxId/messages/:messageId/security-report"),
    ).toBe(true);
    for (const [method, path] of [
      ["GET", "/admin/security/reports"],
      ["PATCH", "/admin/security/reports/:reportId"],
      ["GET", "/admin/security/policies"],
      ["POST", "/admin/security/policies"],
      ["PATCH", "/admin/security/policies/:policyId"],
      ["DELETE", "/admin/security/policies/:policyId"],
      ["GET", "/admin/security/protected-identities"],
      ["POST", "/admin/security/protected-identities"],
      ["DELETE", "/admin/security/protected-identities/:identityId"],
      ["GET", "/admin/security/settings"],
      ["PATCH", "/admin/security/settings"],
    ] as const) {
      expect(api.routes.some((route) => route.method === method && route.path === path)).toBe(true);
    }
  });
});
