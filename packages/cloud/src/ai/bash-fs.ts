import type { FsStat, IFileSystem, MkdirOptions, RmOptions } from "just-bash";
import { aiFileStore, guessAiMediaType } from "./files-store";

// Structural mirrors of just-bash types that aren't re-exported from the package root.
type DirentEntry = { name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean };
type ReadFileOptionsLike = Parameters<IFileSystem["readFile"]>[1];
type WriteFileOptionsLike = Parameters<IFileSystem["writeFile"]>[2];

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const toBytes = (content: string | Uint8Array): Uint8Array => (typeof content === "string" ? textEncoder.encode(content) : content);

const fileStat = (size: number, mtime: Date): FsStat => ({
  isFile: true,
  isDirectory: false,
  isSymbolicLink: false,
  mode: 0o644,
  size,
  mtime,
});

const dirStat = (): FsStat => ({
  isFile: false,
  isDirectory: true,
  isSymbolicLink: false,
  mode: 0o755,
  size: 0,
  mtime: new Date(0),
});

const normalize = (path: string): string => {
  const segments: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return `/${segments.join("/")}`;
};

const joinPath = (base: string, path: string): string => (path.startsWith("/") ? normalize(path) : normalize(`${base}/${path}`));

/** Immediate child names for `dir` given a flat list of file paths. */
const childrenOf = (paths: string[], dir: string): DirentEntry[] => {
  const prefix = dir === "/" ? "/" : `${dir}/`;
  const seen = new Map<string, boolean>();
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (!rest) continue;
    const [head, ...tail] = rest.split("/");
    if (!head) continue;
    const isDirectory = tail.length > 0;
    seen.set(head, seen.get(head) || isDirectory);
  }
  return [...seen.entries()].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory, isSymbolicLink: false }));
};

/**
 * Shared scaffolding for our virtual filesystems: flat path→file model with
 * implicit directories, POSIX-ish semantics, no links/permissions. Backends
 * only implement list/read/write/delete.
 */
abstract class FlatFsBase implements IFileSystem {
  protected abstract listPaths(): Promise<{ path: string; size: number; mtime: Date }[]>;
  protected abstract readBytes(path: string): Promise<Uint8Array | null>;
  protected abstract writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  protected abstract deletePath(path: string, recursive: boolean): Promise<number>;
  protected readonly readOnlyLabel: string | null = null;

  private assertWritable(): void {
    if (this.readOnlyLabel) throw new Error(`${this.readOnlyLabel} is read-only.`);
  }

  async readFile(path: string, _options?: ReadFileOptionsLike): Promise<string> {
    const bytes = await this.readBytes(normalize(path));
    if (bytes === null) throw new Error(`No such file: ${path}`);
    return textDecoder.decode(bytes);
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const bytes = await this.readBytes(normalize(path));
    if (bytes === null) throw new Error(`No such file: ${path}`);
    return bytes;
  }

  async writeFile(path: string, content: string | Uint8Array, _options?: WriteFileOptionsLike): Promise<void> {
    this.assertWritable();
    await this.writeBytes(normalize(path), toBytes(content));
  }

  async appendFile(path: string, content: string | Uint8Array, _options?: WriteFileOptionsLike): Promise<void> {
    this.assertWritable();
    const normalized = normalize(path);
    const existing = await this.readBytes(normalized);
    const next = toBytes(content);
    await this.writeBytes(normalized, existing ? new Uint8Array([...existing, ...next]) : next);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalize(path);
    if (normalized === "/") return true;
    if ((await this.readBytes(normalized)) !== null) return true;
    const paths = (await this.listPaths()).map((entry) => entry.path);
    return paths.some((candidate) => candidate.startsWith(`${normalized}/`));
  }

  async stat(path: string): Promise<FsStat> {
    const normalized = normalize(path);
    if (normalized === "/") return dirStat();
    const entries = await this.listPaths();
    const file = entries.find((entry) => entry.path === normalized);
    if (file) return fileStat(file.size, file.mtime);
    if (entries.some((entry) => entry.path.startsWith(`${normalized}/`))) return dirStat();
    throw new Error(`No such file or directory: ${path}`);
  }

  async mkdir(_path: string, _options?: MkdirOptions): Promise<void> {
    // Directories are implicit (they exist when files exist beneath them).
    this.assertWritable();
  }

  async readdir(path: string): Promise<string[]> {
    return (await this.readdirWithFileTypes(normalize(path))).map((entry) => entry.name);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const normalized = normalize(path);
    const entries = await this.listPaths();
    if (normalized !== "/" && !entries.some((entry) => entry.path.startsWith(`${normalized}/`))) {
      if (entries.some((entry) => entry.path === normalized)) throw new Error(`Not a directory: ${path}`);
      throw new Error(`No such directory: ${path}`);
    }
    return childrenOf(
      entries.map((entry) => entry.path),
      normalized,
    );
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    this.assertWritable();
    const normalized = normalize(path);
    const removed = await this.deletePath(normalized, options?.recursive ?? false);
    if (removed === 0 && !options?.force) throw new Error(`No such file or directory: ${path}`);
  }

  async cp(src: string, dest: string): Promise<void> {
    this.assertWritable();
    const bytes = await this.readFileBuffer(src);
    await this.writeBytes(normalize(dest), bytes);
  }

  async mv(src: string, dest: string): Promise<void> {
    this.assertWritable();
    await this.cp(src, dest);
    await this.deletePath(normalize(src), false);
  }

  resolvePath(base: string, path: string): string {
    return joinPath(base, path);
  }

  getAllPaths(): string[] {
    // Synchronous by interface contract; our backends are async. Commands that
    // need listings use readdir — an empty result here is acceptable.
    return [];
  }

  async chmod(_path: string, _mode: number): Promise<void> {
    this.assertWritable();
  }

  async symlink(_target: string, _linkPath: string): Promise<void> {
    throw new Error("Symlinks are not supported in this filesystem.");
  }

  async link(_existingPath: string, _newPath: string): Promise<void> {
    throw new Error("Hard links are not supported in this filesystem.");
  }

  async readlink(path: string): Promise<string> {
    throw new Error(`Not a symlink: ${path}`);
  }

  async lstat(path: string): Promise<FsStat> {
    return this.stat(path);
  }

  async realpath(path: string): Promise<string> {
    return normalize(path);
  }

  async utimes(_path: string, _atime: Date, _mtime: Date): Promise<void> {
    this.assertWritable();
  }
}

/**
 * Conversation files backed by Postgres (ai.files). Mounted paths are
 * relative to the mount point; `dbPrefix` maps them back to the stored
 * namespace ("/files/…" or "/input/…"). Every operation hits PG directly —
 * crash-safe and identical on every worker.
 */
export class PgConversationFs extends FlatFsBase {
  protected override readonly readOnlyLabel: string | null;

  constructor(
    private readonly options: {
      conversationId: string;
      dbPrefix: "/files" | "/input";
      readOnly?: boolean;
      maxFileBytes?: number;
      maxConversationBytes?: number;
    },
  ) {
    super();
    this.readOnlyLabel = options.readOnly ? options.dbPrefix : null;
  }

  private dbPath(relative: string): string {
    return `${this.options.dbPrefix}${relative === "/" ? "" : relative}`;
  }

  protected async listPaths(): Promise<{ path: string; size: number; mtime: Date }[]> {
    const stats = await aiFileStore.list({ conversationId: this.options.conversationId, prefix: this.options.dbPrefix });
    return stats.map((stat) => ({
      path: stat.path.slice(this.options.dbPrefix.length) || "/",
      size: stat.size,
      mtime: new Date(stat.updatedAt),
    }));
  }

  protected async readBytes(path: string): Promise<Uint8Array | null> {
    return aiFileStore.readAll({ conversationId: this.options.conversationId, path: this.dbPath(path) });
  }

  protected async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await aiFileStore.write({
      conversationId: this.options.conversationId,
      path: this.dbPath(path),
      bytes,
      mediaType: guessAiMediaType(path),
      maxFileBytes: this.options.maxFileBytes,
      maxConversationBytes: this.options.maxConversationBytes,
    });
  }

  protected async deletePath(path: string, recursive: boolean): Promise<number> {
    return aiFileStore.remove({ conversationId: this.options.conversationId, path: this.dbPath(path), recursive });
  }
}

export type SkillFsFile = { path: string; read: () => Promise<Uint8Array>; size: number; mtime?: Date };

/** Read-only /skills mount: builtin trees (in code) + registry trees (in PG), loaded lazily per file. */
export class SkillsFs extends FlatFsBase {
  protected override readonly readOnlyLabel = "/skills";
  private readonly byPath: Map<string, SkillFsFile>;

  constructor(files: SkillFsFile[]) {
    super();
    this.byPath = new Map(files.map((file) => [normalize(file.path), file]));
  }

  protected async listPaths(): Promise<{ path: string; size: number; mtime: Date }[]> {
    return [...this.byPath.values()].map((file) => ({ path: normalize(file.path), size: file.size, mtime: file.mtime ?? new Date(0) }));
  }

  protected async readBytes(path: string): Promise<Uint8Array | null> {
    const file = this.byPath.get(path);
    return file ? file.read() : null;
  }

  protected async writeBytes(): Promise<void> {
    throw new Error("/skills is read-only.");
  }

  protected async deletePath(): Promise<number> {
    throw new Error("/skills is read-only.");
  }
}
