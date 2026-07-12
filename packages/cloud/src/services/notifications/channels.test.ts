import { describe, expect, test } from "bun:test";
import { getNotificationChannel } from "./channels";

describe("notification channel drivers", () => {
  test("derives a stable provider key for repeated email attempts", async () => {
    const driver = getNotificationChannel("email");
    if (!driver) throw new Error("Email notification driver is not registered");
    const [destination] = await driver.resolveDestinations({ userId: null, email: "user@example.test" });
    if (!destination) throw new Error("Email notification destination was not resolved");
    const event = { id: "82de6a89-53ed-4b96-a7b7-55ce46ad1cb0", definitionId: "test.email" };

    const first = driver.createPayload({ presentation: { title: "Test" }, destination, event });
    const second = driver.createPayload({ presentation: { title: "Test" }, destination, event });

    expect(first).toEqual(expect.objectContaining({ messageId: `<cloud-notification-${event.id}@cloud.invalid>` }));
    expect(second).toEqual(first);
  });
});
