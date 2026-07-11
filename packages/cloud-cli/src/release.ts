import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CLI_RELEASE_REPOSITORY = "ValentinKolb/cloud";
export const CLI_RELEASE_BASE = `https://github.com/${CLI_RELEASE_REPOSITORY}/releases`;
export const CLI_RELEASE_API_BASE = `https://api.github.com/repos/${CLI_RELEASE_REPOSITORY}`;

const MAX_RELEASE_FILE_BYTES = 512 * 1024 * 1024;
const cliReleaseTag = /^cli-v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export type CliRelease = {
  tag: string;
  version: string;
};

export type CliTarget = {
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
  asset: string;
};

type GithubRelease = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
};

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ReleaseSource = {
  apiBase?: string;
  releaseBase?: string;
  fetchImpl?: FetchImplementation;
};

type UpdateOptions = ReleaseSource & {
  version?: string;
  executablePath?: string;
  standalone?: boolean;
  target?: CliTarget;
  verifyCosign?: boolean;
  confirm?: (message: string) => Promise<boolean>;
};

export type CliUpdateResult = {
  release: CliRelease;
  target: CliTarget;
  cosign: "verified" | "unavailable" | "skipped";
};

const normalizeBase = (value: string): string => value.replace(/\/+$/, "");

const releaseSource = (source: ReleaseSource) => ({
  apiBase: normalizeBase(source.apiBase ?? process.env.CLD_RELEASE_API_BASE ?? CLI_RELEASE_API_BASE),
  releaseBase: normalizeBase(source.releaseBase ?? process.env.CLD_RELEASE_BASE ?? CLI_RELEASE_BASE),
  fetchImpl: source.fetchImpl ?? fetch,
});

const toCliTag = (version: string): string => (version.startsWith("cli-v") ? version : `cli-v${version.replace(/^v/, "")}`);

export const resolveCliTarget = (os = platform(), cpu = arch()): CliTarget => {
  if (os !== "darwin" && os !== "linux") throw new Error(`Cloud CLI does not support ${os}. Use macOS or Linux.`);
  const normalizedArch = cpu === "x64" ? "x64" : cpu === "arm64" ? "arm64" : null;
  if (!normalizedArch) throw new Error(`Cloud CLI does not support ${cpu} CPUs.`);
  return { os, arch: normalizedArch, asset: `cld_${os}_${normalizedArch}` };
};

const parseRelease = (value: GithubRelease): CliRelease | null => {
  if (value.draft === true || value.prerelease === true || typeof value.tag_name !== "string" || !cliReleaseTag.test(value.tag_name))
    return null;
  return { tag: value.tag_name, version: value.tag_name.slice("cli-v".length) };
};

export const resolveCliRelease = async (version: string | undefined, source: ReleaseSource = {}): Promise<CliRelease> => {
  const { apiBase, fetchImpl } = releaseSource(source);
  const requestedTag = version ? toCliTag(version) : undefined;
  const url = requestedTag ? `${apiBase}/releases/tags/${encodeURIComponent(requestedTag)}` : `${apiBase}/releases?per_page=100`;
  const response = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`Could not resolve Cloud CLI release (${response.status}).`);
  const payload = (await response.json()) as unknown;

  if (requestedTag) {
    if (!payload || typeof payload !== "object") throw new Error(`Cloud CLI release ${requestedTag} is invalid.`);
    const release = parseRelease(payload as GithubRelease);
    if (!release || release.tag !== requestedTag) throw new Error(`Cloud CLI release ${requestedTag} was not found.`);
    return release;
  }

  if (!Array.isArray(payload)) throw new Error("Cloud CLI release response is invalid.");
  const release = payload.map((entry) => (entry && typeof entry === "object" ? parseRelease(entry as GithubRelease) : null)).find(Boolean);
  if (!release) throw new Error("No Cloud CLI release is available.");
  return release;
};

const fetchBytes = async (url: string, fetchImpl: FetchImplementation): Promise<Uint8Array> => {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Could not download ${url} (${response.status}).`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RELEASE_FILE_BYTES) throw new Error("Cloud CLI release asset is too large.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RELEASE_FILE_BYTES) throw new Error("Cloud CLI release asset is too large.");
  return bytes;
};

const expectedChecksum = (manifest: string, asset: string): string => {
  for (const line of manifest.split(/\r?\n/)) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match?.[2] === asset) return match[1]!.toLowerCase();
  }
  throw new Error(`${asset} is not listed in checksums.txt.`);
};

const verifyChecksum = (asset: Uint8Array, expected: string): void => {
  const actual = createHash("sha256").update(asset).digest("hex");
  if (actual !== expected) throw new Error("Cloud CLI checksum verification failed.");
};

const verifyCosign = async (
  directory: string,
  manifest: Uint8Array,
  signature: Uint8Array,
  certificate: Uint8Array,
): Promise<"verified" | "unavailable"> => {
  if (!Bun.which("cosign")) return "unavailable";
  const manifestPath = join(directory, "checksums.txt");
  const signaturePath = join(directory, "checksums.txt.sig");
  const certificatePath = join(directory, "checksums.txt.pem");
  await Promise.all([
    writeFile(manifestPath, manifest, { mode: 0o600 }),
    writeFile(signaturePath, signature, { mode: 0o600 }),
    writeFile(certificatePath, certificate, { mode: 0o600 }),
  ]);
  try {
    await execFileAsync("cosign", [
      "verify-blob",
      "--certificate",
      certificatePath,
      "--signature",
      signaturePath,
      "--certificate-identity-regexp",
      `^https://github.com/${CLI_RELEASE_REPOSITORY}/`,
      "--certificate-oidc-issuer",
      "https://token.actions.githubusercontent.com",
      manifestPath,
    ]);
  } catch {
    throw new Error("Cloud CLI Cosign verification failed.");
  }
  return "verified";
};

const stageBinary = async (directory: string, asset: string, bytes: Uint8Array): Promise<string> => {
  const staged = join(directory, `.${asset}.installing-${process.pid}`);
  await writeFile(staged, bytes, { mode: 0o755 });
  await chmod(staged, 0o755);
  return staged;
};

const replaceBinary = async (staged: string, destination: string): Promise<void> => {
  const backup = join(dirname(destination), `.${basename(destination)}.backup-${process.pid}`);
  const destinationExists = await stat(destination)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  let backupCreated = false;
  try {
    if (destinationExists) {
      await rename(destination, backup);
      backupCreated = true;
    }
    await rename(staged, destination);
  } catch (error) {
    await rm(staged, { force: true });
    if (backupCreated) {
      await rm(destination, { force: true });
      await rename(backup, destination).catch(() => undefined);
    }
    throw error;
  }
  if (backupCreated) await rm(backup, { force: true }).catch(() => undefined);
};

export const updateCli = async (options: UpdateOptions = {}): Promise<CliUpdateResult> => {
  const executablePath = options.executablePath ?? process.execPath;
  const standalone = options.standalone ?? (Bun as typeof Bun & { isStandaloneExecutable?: boolean }).isStandaloneExecutable === true;
  if (!standalone) throw new Error("cld update is only available from an installed Cloud CLI binary.");

  const source = releaseSource(options);
  const [release, target] = await Promise.all([
    resolveCliRelease(options.version, source),
    Promise.resolve(options.target ?? resolveCliTarget()),
  ]);
  const currentVersion = typeof __CLD_VERSION__ === "string" ? __CLD_VERSION__ : "0.0.0-dev";
  if (release.version === currentVersion) return { release, target, cosign: "skipped" };

  if (options.confirm && !(await options.confirm(`Update cld ${currentVersion} to ${release.version}?`))) {
    throw new Error("Update cancelled.");
  }

  const directory = dirname(executablePath);
  const temporaryDirectory = await mkdtemp(join(directory, ".cld-update-"));
  try {
    const downloadBase = `${source.releaseBase}/download/${release.tag}`;
    const manifest = await fetchBytes(`${downloadBase}/checksums.txt`, source.fetchImpl);
    const cosign =
      options.verifyCosign === false
        ? "skipped"
        : await verifyCosign(
            temporaryDirectory,
            manifest,
            await fetchBytes(`${downloadBase}/checksums.txt.sig`, source.fetchImpl),
            await fetchBytes(`${downloadBase}/checksums.txt.pem`, source.fetchImpl),
          );
    const binary = await fetchBytes(`${downloadBase}/${target.asset}`, source.fetchImpl);
    verifyChecksum(binary, expectedChecksum(new TextDecoder().decode(manifest), target.asset));
    const staged = await stageBinary(directory, target.asset, binary);
    await replaceBinary(staged, executablePath);
    return { release, target, cosign };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

declare const __CLD_VERSION__: string;
