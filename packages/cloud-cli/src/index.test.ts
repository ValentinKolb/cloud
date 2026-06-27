import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

type MockServerState = {
  refreshCalls: number;
  revokeCalls: number;
  meCalls: number;
  failFirstMe?: boolean;
};

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "cld-cli-test-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const testUser = {
  id: "user-id",
  uid: "tester",
  provider: "local",
  profile: "user",
  roles: ["user"],
  givenname: "Test",
  sn: "User",
  displayName: "Test User",
  mail: "test@example.test",
  memberofGroup: [],
  manages: [],
  accountExpires: null,
  lastLoginLocal: null,
  ipa: null,
};

const startMockServer = (state: MockServerState) =>
  Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/oauth/token") {
        state.refreshCalls += 1;
        const body = await request.formData();
        expect(body.get("grant_type")).toBe("refresh_token");
        return Response.json({
          access_token: "new-access",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: null,
          scope: "openid",
          refresh_token: "new-refresh",
        });
      }

      if (url.pathname === "/oauth/revoke") {
        state.revokeCalls += 1;
        return new Response(null, { status: 200 });
      }

      if (url.pathname === "/api/me") {
        state.meCalls += 1;
        if (state.failFirstMe && state.meCalls === 1) {
          return Response.json({ message: "expired" }, { status: 401 });
        }
        return Response.json(testUser);
      }

      return Response.json({ message: "not found" }, { status: 404 });
    },
  });

const writeConfig = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};

const runCli = async (configPath: string, args: string[], extraEnv: Record<string, string> = {}) => {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "packages/cloud-cli/src/index.ts", ...args],
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv, CLD_CONFIG: configPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode, stdout, stderr };
};

describe("cloud CLI OAuth session handling", () => {
  test("refresh recovers stale profile locks and persists the rotated token", async () => {
    const state: MockServerState = { refreshCalls: 0, revokeCalls: 0, meCalls: 0 };
    const server = startMockServer(state);
    const dir = await createTempDir();
    const configPath = join(dir, "config.json");
    const lockPath = join(dir, "locks", "default.lock");

    try {
      await writeConfig(configPath, {
        currentProfile: "default",
        profiles: {
          default: {
            server: `http://127.0.0.1:${server.port}`,
            oauth: {
              clientId: "cloud-cli",
              accessToken: "old-access",
              accessTokenExpiresAt: "2000-01-01T00:00:00.000Z",
              refreshToken: "old-refresh",
              scope: "openid",
            },
          },
        },
      });
      await mkdir(lockPath, { recursive: true });
      await writeFile(join(lockPath, "owner.json"), JSON.stringify({ pid: 999_999_999, createdAt: Date.now() }), { mode: 0o600 });

      const result = await runCli(configPath, ["account", "whoami", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(state.refreshCalls).toBe(1);
      expect(state.revokeCalls).toBe(0);

      const config = JSON.parse(await readFile(configPath, "utf8")) as {
        profiles: { default: { oauth: { accessToken: string; refreshToken: string } } };
      };
      expect(config.profiles.default.oauth.accessToken).toBe("new-access");
      expect(config.profiles.default.oauth.refreshToken).toBe("new-refresh");
    } finally {
      server.stop(true);
    }
  });

  test("401 responses refresh once and retry with the new access token", async () => {
    const state: MockServerState = { refreshCalls: 0, revokeCalls: 0, meCalls: 0, failFirstMe: true };
    const server = startMockServer(state);
    const dir = await createTempDir();
    const configPath = join(dir, "config.json");

    try {
      await writeConfig(configPath, {
        currentProfile: "default",
        profiles: {
          default: {
            server: `http://127.0.0.1:${server.port}`,
            oauth: {
              clientId: "cloud-cli",
              accessToken: "stale-access",
              accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
              refreshToken: "old-refresh",
              scope: "openid",
            },
          },
        },
      });

      const result = await runCli(configPath, ["account", "whoami", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(state.meCalls).toBe(2);
      expect(state.refreshCalls).toBe(1);
      expect(result.stdout).toContain("tester");
    } finally {
      server.stop(true);
    }
  });

  test("failed fd0 refresh-token persistence revokes the new token and removes the local OAuth session", async () => {
    const state: MockServerState = { refreshCalls: 0, revokeCalls: 0, meCalls: 0 };
    const server = startMockServer(state);
    const dir = await createTempDir();
    const configPath = join(dir, "config.json");
    const binDir = join(dir, "bin");
    const fd0Path = join(binDir, "fd0");

    try {
      await mkdir(binDir, { recursive: true });
      await writeFile(
        fd0Path,
        `#!/bin/sh
if [ "$1" = "get" ]; then
  printf '%s\n' old-refresh
  exit 0
fi
if [ "$1" = "set" ]; then
  echo "fd0 write failed" >&2
  exit 1
fi
exit 0
`,
        { mode: 0o700 },
      );
      await chmod(fd0Path, 0o700);
      await writeConfig(configPath, {
        currentProfile: "default",
        profiles: {
          default: {
            server: `http://127.0.0.1:${server.port}`,
            oauth: {
              clientId: "cloud-cli",
              accessToken: "old-access",
              accessTokenExpiresAt: "2000-01-01T00:00:00.000Z",
              refreshTokenFd0: { name: "cloud-default-oauth-refresh-token" },
              scope: "openid",
            },
          },
        },
      });

      const result = await runCli(configPath, ["account", "whoami", "--json"], { PATH: `${binDir}:${process.env.PATH ?? ""}` });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("fd0 write failed");
      expect(state.refreshCalls).toBe(1);
      expect(state.revokeCalls).toBe(1);

      const config = JSON.parse(await readFile(configPath, "utf8")) as { profiles: { default: { oauth?: unknown } } };
      expect(config.profiles.default.oauth).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });
});
