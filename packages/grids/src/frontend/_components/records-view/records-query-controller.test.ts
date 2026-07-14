import { describe, expect, test } from "bun:test";
import { createLatestRequestController, recordsQueryFailure } from "./records-query-controller";

describe("recordsQueryFailure", () => {
  test("normalizes refresh failures", () => {
    const failure = recordsQueryFailure(new Error("offline"));
    expect(failure?.error.message).toBe("offline");
  });

  test("does not surface request cancellation", () => {
    expect(recordsQueryFailure(new DOMException("aborted", "AbortError"))).toBeNull();
  });
});

describe("createLatestRequestController", () => {
  test("aborts the previous request when a newer request starts", () => {
    const requests = createLatestRequestController();
    const first = requests.start();
    const second = requests.start();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);

    requests.finish(first);
    requests.abort();
    expect(second.signal.aborted).toBe(true);
  });
});
