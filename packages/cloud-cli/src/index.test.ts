import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

type MockServerState = {
  refreshCalls: number;
  authorizationCodeCalls?: number;
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
        const body = await request.formData();
        const grantType = body.get("grant_type");
        if (grantType === "authorization_code") {
          state.authorizationCodeCalls = (state.authorizationCodeCalls ?? 0) + 1;
          expect(body.get("code")).toBe("test-code");
          expect(body.get("client_id")).toBe("cloud-cli");
          expect(body.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        } else {
          state.refreshCalls += 1;
          expect(grantType).toBe("refresh_token");
        }
        return Response.json({
          access_token: grantType === "authorization_code" ? "login-access" : "new-access",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: null,
          scope: "openid",
          refresh_token: grantType === "authorization_code" ? "login-refresh" : "new-refresh",
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

const startCli = (configPath: string, args: string[], extraEnv: Record<string, string> = {}) =>
  Bun.spawn({
    cmd: [process.execPath, "run", "packages/cloud-cli/src/index.ts", ...args],
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv, CLD_CONFIG: configPath },
    stdout: "pipe",
    stderr: "pipe",
  });

const writeConfig = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};

const runCli = async (configPath: string, args: string[], extraEnv: Record<string, string> = {}) => {
  const proc = startCli(configPath, args, extraEnv);
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode, stdout, stderr };
};

const readUntil = async (stream: ReadableStream<Uint8Array>, marker: string): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (!text.includes(marker)) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  reader.releaseLock();
  return text;
};

describe("cloud CLI OAuth session handling", () => {
  test("prints its version without requiring a configured server", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "config.json");

    const result = await runCli(configPath, ["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/^cld 0\.0\.0-dev \(unknown\)\n$/);
  });

  test("prints compact JSON errors in JSON Lines mode", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "config.json");

    const result = await runCli(configPath, ["--jsonl", "missing-module"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: { message: 'Unknown module "missing-module". Run `cld help`.', exitCode: 1 },
    });
  });

  test("rejects incomplete update versions before contacting a release server", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "config.json");

    const result = await runCli(configPath, ["update", "--version"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--version requires a value.");
  });

  test("top-level help includes the built-in app modules", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "config.json");

    const result = await runCli(configPath, ["help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("assistant");
    expect(result.stdout).toContain("Chat with the Cloud Assistant");
    expect(result.stdout).toContain("grids");
    expect(result.stdout).toContain("Manage Grids bases");
    expect(result.stdout).toContain("mail");
    expect(result.stdout).toContain("Search, read, configure, and operate Cloud Mail");
  });

  test("nested module help does not require a configured server", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "config.json");

    const result = await runCli(configPath, ["notebooks", "access", "grant", "help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("cld notebooks access grant");
    expect(result.stdout).toContain("--permission <value>");
  });

  test("login callback returns a browser-readable completion page", async () => {
    const state: MockServerState = { refreshCalls: 0, authorizationCodeCalls: 0, revokeCalls: 0, meCalls: 0 };
    const server = startMockServer(state);
    const dir = await createTempDir();
    const configPath = join(dir, "config.json");

    try {
      const proc = startCli(configPath, ["login", "local", "--server", `http://127.0.0.1:${server.port}`, "--no-open"]);
      const stderrPromise = new Response(proc.stderr).text();
      const stdout = await readUntil(proc.stdout, "Waiting for the OAuth callback.");
      const loginUrlMatch = stdout.match(/Login URL:\n(?<url>http:\/\/127\.0\.0\.1:\d+\/oauth\/authorize[^\n]+)/);
      const printedLoginUrl = loginUrlMatch?.groups?.url;
      expect(printedLoginUrl).toBeString();
      if (!printedLoginUrl) throw new Error("CLI did not print a login URL.");

      const loginUrl = new URL(printedLoginUrl);
      const redirectUri = loginUrl.searchParams.get("redirect_uri");
      const stateParam = loginUrl.searchParams.get("state");
      expect(redirectUri).toBeString();
      expect(stateParam).toBeString();

      const callbackUrl = new URL(redirectUri!);
      callbackUrl.searchParams.set("code", "test-code");
      callbackUrl.searchParams.set("state", stateParam!);
      const callbackResponse = await fetch(callbackUrl);
      const callbackHtml = await callbackResponse.text();

      expect(callbackResponse.status).toBe(200);
      expect(callbackResponse.headers.get("content-type")).toContain("text/html");
      expect(callbackHtml).toContain("Login succeeded");
      expect(callbackHtml).toContain("You can close this window and return to your terminal.");

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
      expect(await stderrPromise).toBe("");
      expect(state.authorizationCodeCalls).toBe(1);

      const config = JSON.parse(await readFile(configPath, "utf8")) as {
        currentProfile: string;
        profiles: { local: { oauth: { accessToken: string; refreshToken: string } } };
      };
      expect(config.currentProfile).toBe("local");
      expect(config.profiles.local.oauth.accessToken).toBe("login-access");
      expect(config.profiles.local.oauth.refreshToken).toBe("login-refresh");
    } finally {
      server.stop(true);
    }
  });

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

  test("prints JSON errors when --json is requested", async () => {
    const dir = await createTempDir();
    const configPath = join(dir, "config.json");

    const result = await runCli(configPath, ["--json", "admin", "status"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");

    const payload = JSON.parse(result.stderr) as { error: { message: string; exitCode: number } };
    expect(payload.error.message).toContain("No server configured");
    expect(payload.error.exitCode).toBe(1);
  });
});
