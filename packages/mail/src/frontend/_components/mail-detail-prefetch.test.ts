import { describe, expect, test } from "bun:test";
import { createMailDetailPrefetchCache } from "./mail-detail-prefetch";

describe("Mail detail prefetch", () => {
  test("deduplicates requests and keeps a bounded LRU", async () => {
    const cache = createMailDetailPrefetchCache<number>(2);
    let loads = 0;
    const loader = async () => ++loads;
    expect(await Promise.all([cache.load("a", loader), cache.load("a", loader)])).toEqual([1, 1]);
    await cache.load("b", loader);
    cache.get("a");
    await cache.load("c", loader);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.size()).toBe(2);
  });

  test("cancels stale requests on retain and clear", async () => {
    const cache = createMailDetailPrefetchCache<number>(2);
    let aborted = false;
    const pending = cache.load(
      "stale",
      (signal) =>
        new Promise<number>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    cache.retain(new Set());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(aborted).toBe(true);
    expect(cache.size()).toBe(0);
  });
});
