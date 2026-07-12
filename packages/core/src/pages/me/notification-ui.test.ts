import { describe, expect, test } from "bun:test";
import { notificationChannelAvailability } from "./notification-ui";

describe("notification channel availability", () => {
  test("keeps browser preferences disabled while device state is unknown or off", () => {
    expect(notificationChannelAvailability("browser", true, null)).toEqual({
      enabled: false,
      description: "Checking browser notification status...",
    });
    expect(
      notificationChannelAvailability("browser", true, {
        supported: true,
        permission: "default",
        enabled: false,
      }),
    ).toEqual({
      enabled: false,
      description: "Enable browser notifications on this device above before selecting this channel.",
      warning: "Browser notifications are disabled on this device.",
    });
  });

  test("enables browser preferences only for an active local subscription", () => {
    expect(
      notificationChannelAvailability("browser", true, {
        supported: true,
        permission: "granted",
        enabled: true,
      }),
    ).toEqual({ enabled: true });
  });

  test("does not apply browser device state to other channels", () => {
    expect(notificationChannelAvailability("email", true, null)).toEqual({ enabled: true });
    expect(notificationChannelAvailability("email", false, null)).toEqual({
      enabled: false,
      description: "This channel is currently unavailable.",
    });
  });
});
