import { describe, expect, test } from "bun:test";
import { combineCapabilitySignals } from "./signals";

describe("capability server signals", () => {
  test("cancels when either the caller or invocation signal aborts", () => {
    const caller = new AbortController();
    const invocation = new AbortController();
    const combined = combineCapabilitySignals(caller.signal, invocation.signal);
    expect(combined?.aborted).toBe(false);
    invocation.abort();
    expect(combined?.aborted).toBe(true);

    const nextCaller = new AbortController();
    const nextInvocation = new AbortController();
    const nextCombined = combineCapabilitySignals(nextCaller.signal, nextInvocation.signal);
    nextCaller.abort();
    expect(nextCombined?.aborted).toBe(true);
  });
});
