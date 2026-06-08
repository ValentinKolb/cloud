import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import type {
  MarkdownDirectoryNode,
  MarkdownFileContent,
  MarkdownFileNode,
  MarkdownFolder,
  MarkdownTreeNode,
  MarkdownWorkspace,
} from "../bridge/types";
import { DesktopLabStore } from "./local-db";

const markdownExtensions = new Set([".md", ".markdown", ".mdown"]);
const ignoredDirectories = new Set([".git", "node_modules", ".DS_Store"]);

const stableId = (path: string) => Buffer.from(path).toString("base64url");

const isMarkdownFile = (path: string) => markdownExtensions.has(extname(path).toLowerCase());

const normalizeMarkdownFilename = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("File name is required.");
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed === "." || trimmed === "..") {
    throw new Error("File name must not contain path separators.");
  }
  return isMarkdownFile(trimmed) ? trimmed : `${trimmed}.md`;
};

const isInside = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
};

const countFiles = (nodes: MarkdownTreeNode[]): number =>
  nodes.reduce((total, node) => total + (node.kind === "file" ? 1 : countFiles(node.children)), 0);

const sortNodes = (nodes: MarkdownTreeNode[]) =>
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

const scanDirectory = (root: string, current: string): MarkdownTreeNode[] => {
  const nodes: MarkdownTreeNode[] = [];

  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".notes") continue;
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;

    const path = join(current, entry.name);
    const relativePath = relative(root, path);

    if (entry.isDirectory()) {
      const children = scanDirectory(root, path);
      if (children.length === 0) continue;
      nodes.push({
        kind: "directory",
        id: stableId(path),
        name: entry.name,
        path,
        relativePath,
        children,
      } satisfies MarkdownDirectoryNode);
      continue;
    }

    if (!entry.isFile() || !isMarkdownFile(path)) continue;
    const stats = statSync(path);
    nodes.push({
      kind: "file",
      id: stableId(path),
      name: entry.name,
      path,
      relativePath,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    } satisfies MarkdownFileNode);
  }

  return sortNodes(nodes);
};

const folderFromPath = (path: string): MarkdownFolder => {
  const resolved = resolve(path);
  const stats = statSync(resolved);
  if (!stats.isDirectory()) throw new Error(`${resolved} is not a directory.`);
  const tree = scanDirectory(resolved, resolved);
  return {
    id: stableId(resolved),
    name: basename(resolved) || resolved,
    path: resolved,
    addedAt: new Date().toISOString(),
    fileCount: countFiles(tree),
    tree,
  };
};

export class MarkdownWorkspaceService {
  constructor(private readonly store: DesktopLabStore) {}

  getWorkspace(): MarkdownWorkspace {
    try {
      const folders = this.store.getMarkdownFolderPaths().map(folderFromPath);
      const workspace = { folders, lastFilePath: this.store.getLastMarkdownFilePath() };
      this.store.saveMarkdownWorkspaceSnapshot(workspace);
      return workspace;
    } catch (error) {
      const snapshot = this.store.getMarkdownWorkspaceSnapshot();
      if (snapshot.folders.length > 0) return snapshot;
      throw error;
    }
  }

  addFolder(path: string): MarkdownWorkspace {
    const folder = folderFromPath(path);
    this.store.addMarkdownFolder(folder.path);
    return this.getWorkspace();
  }

  removeFolder(id: string): MarkdownWorkspace {
    const folder = this.getWorkspace().folders.find((item) => item.id === id);
    if (!folder) return this.getWorkspace();
    this.store.removeMarkdownFolder(folder.path);
    return this.getWorkspace();
  }

  readFile(path: string): MarkdownFileContent {
    const resolved = resolve(path);
    if (!isMarkdownFile(resolved)) throw new Error("Only markdown files can be opened.");
    const folderId = this.getWorkspace().folders.find((folder) => isInside(folder.path, resolved))?.id ?? null;
    const stats = statSync(resolved);
    if (!stats.isFile()) throw new Error(`${resolved} is not a file.`);
    const markdown = readFileSync(resolved, "utf8");
    this.store.setLastMarkdownFilePath(resolved);
    return {
      path: resolved,
      folderId,
      name: basename(resolved),
      markdown,
      updatedAt: stats.mtime.toISOString(),
      size: stats.size,
    };
  }

  saveFile(path: string, markdown: string): MarkdownFileContent {
    const resolved = resolve(path);
    if (!isMarkdownFile(resolved)) throw new Error("Only markdown files can be saved.");
    writeFileSync(resolved, markdown, "utf8");
    return this.readFile(resolved);
  }

  createFile(folderId: string, name: string): MarkdownFileContent {
    const folder = this.getWorkspace().folders.find((item) => item.id === folderId);
    if (!folder) throw new Error("Folder not found.");
    const target = resolve(folder.path, normalizeMarkdownFilename(name));
    if (!isInside(folder.path, target)) throw new Error("File must stay inside the selected folder.");
    if (existsSync(target)) throw new Error(`${basename(target)} already exists.`);
    writeFileSync(target, `# ${basename(target, extname(target))}\n`, "utf8");
    return this.readFile(target);
  }

  renameFile(path: string, name: string): MarkdownFileContent {
    const resolved = resolve(path);
    if (!isMarkdownFile(resolved)) throw new Error("Only markdown files can be renamed.");
    const stats = statSync(resolved);
    if (!stats.isFile()) throw new Error(`${resolved} is not a file.`);
    const folder = this.getWorkspace().folders.find((item) => isInside(item.path, resolved));
    if (!folder) throw new Error("File is not inside an added folder.");
    const target = resolve(dirname(resolved), normalizeMarkdownFilename(name));
    if (!isInside(folder.path, target)) throw new Error("File must stay inside its workspace folder.");
    if (target !== resolved && existsSync(target)) throw new Error(`${basename(target)} already exists.`);
    renameSync(resolved, target);
    return this.readFile(target);
  }

  deleteFile(path: string): MarkdownWorkspace {
    const resolved = resolve(path);
    if (!isMarkdownFile(resolved)) throw new Error("Only markdown files can be deleted.");
    const folder = this.getWorkspace().folders.find((item) => isInside(item.path, resolved));
    if (!folder) throw new Error("File is not inside an added folder.");
    const stats = statSync(resolved);
    if (!stats.isFile()) throw new Error(`${resolved} is not a file.`);
    unlinkSync(resolved);
    if (this.store.getLastMarkdownFilePath() === resolved) this.store.setLastMarkdownFilePath(null);
    return this.getWorkspace();
  }
}
