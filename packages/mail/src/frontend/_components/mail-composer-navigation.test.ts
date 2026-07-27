import { describe, expect, test } from "bun:test";
import { createMailComposerNavigation } from "./mail-composer-navigation";

describe("Mail composer navigation", () => {
  test("waits for the active draft handoff before allowing navigation", async () => {
    const navigation = createMailComposerNavigation();
    let finish!: (saved: boolean) => void;
    navigation.register(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );

    const first = navigation.prepare();
    expect(await navigation.prepare()).toBe(false);
    finish(true);
    expect(await first).toBe(true);
  });

  test("does not call a stale handoff after its composer unmounts", async () => {
    const navigation = createMailComposerNavigation();
    let calls = 0;
    const unregister = navigation.register(async () => {
      calls += 1;
      return true;
    });

    unregister();

    expect(await navigation.prepare()).toBe(true);
    expect(calls).toBe(0);
  });

  test("rejects a delayed handoff result after the composer unmounts", async () => {
    const navigation = createMailComposerNavigation();
    let finish!: (saved: boolean) => void;
    const unregister = navigation.register(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );

    const pending = navigation.prepare();
    unregister();
    finish(true);

    expect(await pending).toBe(false);
  });

  test("keeps navigation blocked when the draft cannot be handed off", async () => {
    const navigation = createMailComposerNavigation();
    navigation.register(async () => false);

    expect(await navigation.prepare()).toBe(false);
  });
});
