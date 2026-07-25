import { describe, expect, test } from "bun:test";
import { upGaugeIsDown } from "./service";

const sample = (name: string, value: number) => ({ name, help: "", type: "gauge" as const, value });

describe("upGaugeIsDown", () => {
  test("detects a backing source reporting itself down", () => {
    // Postgres and Redis diagnostics never throw — they degrade to an
    // available:false payload — so the collector completed "successfully"
    // and the collectors tile read all-green while the database was down.
    expect(upGaugeIsDown([sample("cloud_postgres_up", 0)], "cloud_postgres_up")).toBe(true);
  });

  test("treats a healthy source as healthy", () => {
    expect(upGaugeIsDown([sample("cloud_postgres_up", 1)], "cloud_postgres_up")).toBe(false);
  });

  test("ignores other collectors' gauges", () => {
    expect(upGaugeIsDown([sample("cloud_redis_up", 0)], "cloud_postgres_up")).toBe(false);
  });

  test("does not flag a collector that emits no up gauge", () => {
    expect(upGaugeIsDown([sample("cloud_logs_entries_total", 0)], "cloud_postgres_up")).toBe(false);
  });
});
