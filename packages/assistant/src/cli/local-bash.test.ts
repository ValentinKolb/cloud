import { describe, expect, test } from "bun:test";
import { runLocalBash } from "./local-bash";

describe("local Assistant Bash tool", () => {
  test("captures exit status and both output streams", async () => {
    const result = await runLocalBash("printf 'hello'; printf 'warning' >&2; exit 7", { timeoutMs: 5_000 });

    expect(result).toEqual({
      status: "completed",
      exitCode: 7,
      stdout: "hello",
      stderr: "warning",
      truncated: false,
    });
  });

  test("bounds captured output without changing command completion", async () => {
    const result = await runLocalBash("printf '123456'; printf 'abcdef' >&2", {
      timeoutMs: 5_000,
      maxStreamBytes: 4,
    });

    expect(result).toEqual({
      status: "completed",
      exitCode: 0,
      stdout: "1234",
      stderr: "abcd",
      truncated: true,
    });
  });

  test("kills commands at the configured timeout", async () => {
    const result = await runLocalBash("sleep 1", { timeoutMs: 10 });

    expect(result.status).toBe("timed_out");
    expect(result.exitCode).toBeNull();
  });
});
