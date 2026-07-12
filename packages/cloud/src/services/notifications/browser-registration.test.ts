import { expect, test } from "bun:test";
import ".";
import { getNotificationChannel } from "./channels";

test("the notification service registers the browser channel in every app process", () => {
  expect(getNotificationChannel("browser")?.id).toBe("browser");
});
