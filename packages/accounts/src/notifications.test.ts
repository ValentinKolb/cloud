import { describe, expect, test } from "bun:test";
import { app } from "./config";

describe("Accounts notification definitions", () => {
  test("binds every notification to the Accounts app", () => {
    expect(Object.keys(app.notifications)).toEqual([
      "loginLink",
      "freeIpaWelcome",
      "localWelcome",
      "accountRequestDenied",
      "administrativeMessage",
    ]);
    expect(app.notifications.loginLink.id).toBe("accounts.loginLink");
    expect(app.notifications.administrativeMessage.id).toBe("accounts.administrativeMessage");
  });

  test("keeps account-access messages on required email", () => {
    expect(app.notifications.loginLink.delivery?.required).toEqual(["email"]);
    expect(app.notifications.freeIpaWelcome.delivery?.required).toEqual(["email"]);
    expect(app.notifications.localWelcome.delivery?.required).toEqual(["email"]);
    expect(app.notifications.accountRequestDenied.delivery?.required).toEqual(["email"]);
  });

  test("allows users to reroute normal administrative messages", () => {
    expect(app.notifications.administrativeMessage.delivery).toEqual({ recommended: ["email"], required: [] });
  });
});
