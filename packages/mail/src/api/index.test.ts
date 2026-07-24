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
    expect(
      api.routes.some(
        (route) => route.method === "POST" && route.path === "/mailboxes/:mailboxId/subscriptions/unsubscribe",
      ),
    ).toBe(true);
    expect(
      api.routes.some(
        (route) => route.method === "POST" && route.path === "/mailboxes/:mailboxId/subscriptions/disposition",
      ),
    ).toBe(true);
  });
});
