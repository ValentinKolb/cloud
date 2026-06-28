import { describe, expect, test } from "bun:test";
import { consumePasswordResetToken, createPasswordResetToken } from "./auth";

describe("local auth password reset tokens", () => {
  test("consumes password reset tokens only once", async () => {
    const payload = {
      userId: crypto.randomUUID(),
      uid: `reset-${crypto.randomUUID()}`,
      email: `reset-${crypto.randomUUID()}@example.test`,
    };
    const token = await createPasswordResetToken({
      ...payload,
      ttlSeconds: 30,
    });

    expect(await consumePasswordResetToken(token)).toEqual(payload);
    expect(await consumePasswordResetToken(token)).toBeNull();
  });
});
