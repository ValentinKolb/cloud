import { describe, expect, test } from "bun:test";
import { startNotificationDefinitionRegistration } from "./catalog";

describe("notification catalog registration", () => {
  test("keeps app startup alive and retries while the Core schema is unavailable", async () => {
    let attempts = 0;
    const stop = await startNotificationDefinitionRegistration(
      "rollout-test",
      {},
      {
        retryMs: 1,
        register: async () => {
          attempts += 1;
          if (attempts === 1) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
        },
      },
    );

    for (let index = 0; index < 50 && attempts < 2; index += 1) await Bun.sleep(2);
    stop();
    expect(attempts).toBe(2);
  });

  test("does not hide non-rollout registration failures", async () => {
    await expect(
      startNotificationDefinitionRegistration(
        "rollout-test",
        {},
        {
          register: async () => {
            throw Object.assign(new Error("permission denied"), { code: "42501" });
          },
        },
      ),
    ).rejects.toThrow("permission denied");
  });

  test("stops retrying and escalates a permanent error after rollout waiting", async () => {
    let attempts = 0;
    let permanentError: unknown;
    const stop = await startNotificationDefinitionRegistration(
      "rollout-test",
      {},
      {
        retryMs: 1,
        onPermanentError: (error) => {
          permanentError = error;
        },
        register: async () => {
          attempts += 1;
          throw Object.assign(new Error(attempts === 1 ? "relation missing" : "permission denied"), {
            code: attempts === 1 ? "42P01" : "42501",
          });
        },
      },
    );

    for (let index = 0; index < 50 && !permanentError; index += 1) await Bun.sleep(2);
    stop();
    expect(attempts).toBe(2);
    expect(permanentError).toEqual(expect.objectContaining({ message: "permission denied", code: "42501" }));
  });
});
