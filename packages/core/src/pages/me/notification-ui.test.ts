import { describe, expect, test } from "bun:test";
import { notificationChannelAvailability, unavailableBrowserNotificationState } from "./notification-ui";

describe("notification channel availability", () => {
  test("provides a terminal fallback when browser inspection fails", () => {
    const state = unavailableBrowserNotificationState();
    expect(state).toEqual({
      supported: false,
      permission: "default",
      enabled: false,
      reason: "Browser notification status could not be checked. Reload this page to try again.",
    });
    expect(notificationChannelAvailability("browser", true, state)).toEqual({
      enabled: false,
      description: state.reason,
      warning: "Browser notifications are unavailable on this device.",
    });
  });

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
