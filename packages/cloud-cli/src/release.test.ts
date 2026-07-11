import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { COSIGN_CERTIFICATE_IDENTITY_REGEXP, resolveCliRelease, updateCli } from "./release";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "cld-release-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

const currentAssetName = () => {
  const os = platform();
  const cpu = arch() === "x64" ? "x64" : arch() === "arm64" ? "arm64" : null;
  if ((os !== "darwin" && os !== "linux") || !cpu) throw new Error("Unsupported release test platform.");
  return `cld_${os}_${cpu}`;
};

describe("Cloud CLI releases", () => {
  test("resolves the highest stable CLI release across pages", async () => {
    const firstPage = [
      { tag_name: "cloud-core-v1.0.0" },
      { tag_name: "cli-v1.9.4" },
      { tag_name: "cli-v2.0.0-rc.1", prerelease: true },
      ...Array.from({ length: 97 }, (_, index) => ({ id: index })),
    ];
    const release = await resolveCliRelease(undefined, {
      fetchImpl: async (input) => {
        const page = new URL(String(input)).searchParams.get("page");
        return Response.json(page === "1" ? firstPage : [{ tag_name: "cli-v2.0.0" }]);
      },
    });

    expect(release).toEqual({ tag: "cli-v2.0.0", version: "2.0.0" });
  });

  test("rejects prerelease versions and pins Cosign to the CLI workflow", async () => {
    await expect(resolveCliRelease("1.2.3-rc.1", { fetchImpl: async () => Response.json({}) })).rejects.toThrow("stable version");
    expect(COSIGN_CERTIFICATE_IDENTITY_REGEXP).toContain("workflows/cli");
    expect(COSIGN_CERTIFICATE_IDENTITY_REGEXP).toContain("refs/tags/cli-v");
  });

  test("updates an installed binary only after checksum verification", async () => {
    const directory = await createTemporaryDirectory();
    const executablePath = join(directory, "cld");
    const assetName = "cld_linux_x64";
    const replacement = new TextEncoder().encode("new binary");
    await writeFile(executablePath, "old binary", { mode: 0o755 });
    await chmod(executablePath, 0o755);

    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/releases") return Response.json([{ tag_name: "cli-v1.2.3" }]);
        if (url.pathname === "/release/download/cli-v1.2.3/checksums.txt") return new Response(`${sha256(replacement)}  ${assetName}\n`);
        if (url.pathname === `/release/download/cli-v1.2.3/${assetName}`) return new Response(replacement);
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const result = await updateCli({
        apiBase: `http://127.0.0.1:${server.port}`,
        releaseBase: `http://127.0.0.1:${server.port}/release`,
        executablePath,
        standalone: true,
        target: { os: "linux", arch: "x64", asset: assetName },
        verifyCosign: false,
        confirm: async () => true,
      });

      expect(result.release.version).toBe("1.2.3");
      expect(await readFile(executablePath, "utf8")).toBe("new binary");
    } finally {
      server.stop(true);
    }
  });

  test("refuses an update when the release checksum does not match", async () => {
    const directory = await createTemporaryDirectory();
    const executablePath = join(directory, "cld");
    const assetName = "cld_linux_x64";
    await writeFile(executablePath, "old binary", { mode: 0o755 });
    await chmod(executablePath, 0o755);

    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/releases") return Response.json([{ tag_name: "cli-v1.2.3" }]);
        if (url.pathname === "/release/download/cli-v1.2.3/checksums.txt") return new Response(`${"0".repeat(64)}  ${assetName}\n`);
        if (url.pathname === `/release/download/cli-v1.2.3/${assetName}`) return new Response("new binary");
        return new Response("not found", { status: 404 });
      },
    });

    try {
      await expect(
        updateCli({
          apiBase: `http://127.0.0.1:${server.port}`,
          releaseBase: `http://127.0.0.1:${server.port}/release`,
          executablePath,
          standalone: true,
          target: { os: "linux", arch: "x64", asset: assetName },
          verifyCosign: false,
          confirm: async () => true,
        }),
      ).rejects.toThrow("checksum verification failed");
      expect(await readFile(executablePath, "utf8")).toBe("old binary");
    } finally {
      server.stop(true);
    }
  });

  test("installs the highest stable CLI release through the shell installer", async () => {
    const directory = await createTemporaryDirectory();
    const prefix = join(directory, "bin");
    const assetName = currentAssetName();
    const binary = new TextEncoder().encode("release binary");
    await mkdir(prefix, { mode: 0o700 });
    await chmod(prefix, 0o700);
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/releases") {
          if (url.searchParams.get("page") !== "1") return Response.json([]);
          return new Response(
            JSON.stringify([{ tag_name: "cloud-core-v9.9.9" }, { tag_name: "cli-v1.9.4" }, { tag_name: "cli-v2.0.0" }], null, 2),
          );
        }
        if (url.pathname === "/release/download/cli-v2.0.0/checksums.txt") return new Response(`${sha256(binary)}  ${assetName}\n`);
        if (url.pathname === `/release/download/cli-v2.0.0/${assetName}`) return new Response(binary);
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const installer = join(import.meta.dir, "..", "scripts", "install.sh");
      const child = Bun.spawn(["sh", installer, `--prefix=${prefix}`, "--yes", "--no-verify"], {
        env: {
          ...process.env,
          CLD_RELEASE_API_BASE: `http://127.0.0.1:${server.port}`,
          CLD_RELEASE_BASE: `http://127.0.0.1:${server.port}/release`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("installed");
      expect(await readFile(join(prefix, "cld"), "utf8")).toBe("release binary");
      expect((await stat(prefix)).mode & 0o777).toBe(0o700);
    } finally {
      server.stop(true);
    }
  });
});
