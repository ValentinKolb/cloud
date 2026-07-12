/**
 * File components tab — FileBrowserPanel (FileTree + FileView) over an
 * in-memory FileSource. The same components power the assistant's chat
 * files modal and the skill explorer; a future Files app only brings its
 * own FileSource + custom renderers.
 */
import { FileBrowserPanel, type FileSource, openFileBrowser } from "@valentinkolb/cloud/ui";
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";

const SAMPLE_MD = `---
name: demo
description: A sample markdown file with frontmatter.
---

# File components

The **FileBrowserPanel** combines \`FileTree\` and \`FileView\` over a \`FileSource\` adapter.

- Markdown files render with an *edit/preview* toggle
- The save button lives in the markdown editor toolbar
- Text files edit in a monospace surface (Ctrl/Cmd+S saves)
`;

const SAMPLE_TS = `export const greet = (name: string): string => {
  return \`Hello, \${name}!\`;
};
`;

/** In-memory FileSource — capability flags decide which UI affordances exist. */
const createMemorySource = (options: { readOnly?: boolean } = {}): FileSource => {
  const files = new Map<string, string>([
    ["/README.md", SAMPLE_MD],
    ["/src/greet.ts", SAMPLE_TS],
    ["/notes/ideas.txt", "Collect ideas here.\nOne per line.\n"],
  ]);
  const mediaType = (path: string) => (path.endsWith(".md") ? "text/markdown" : path.endsWith(".ts") ? "text/typescript" : "text/plain");
  const source: FileSource = {
    list: async () => [...files.entries()].map(([path, content]) => ({ path, size: content.length, mediaType: mediaType(path) })),
    read: async (path) => ({ encoding: "utf8", content: files.get(path) ?? "", mediaType: mediaType(path) }),
  };
  if (options.readOnly) return source;
  return {
    ...source,
    write: async (path, content) => void files.set(path, content),
    remove: async (path) => void files.delete(path),
    rename: async (from, to) => {
      const content = files.get(from) ?? "";
      files.delete(from);
      files.set(to, content);
    },
  };
};

export const FileBrowserDemo = () => (
  <DemoCard
    id="file-browser"
    chip={[
      { kind: "component", name: "FileBrowserPanel", from: FROM_UI },
      { kind: "component", name: "FileTree", from: FROM_UI },
      { kind: "component", name: "FileView", from: FROM_UI },
    ]}
    description="Path-first file browser: the tree derives folders from flat paths; capabilities (edit, delete, rename, upload) come from the FileSource's optional methods. Rows have a hover ⋯ menu and right-click context menu; files move via drag & drop onto folders. Markdown edits in the markdown editor (save lives in its toolbar), plain text in an identical editor shell — Ctrl/Cmd+S saves in both."
    code={`const source: FileSource = {
  list: async () => [{ path: "/README.md", size: 120, mediaType: "text/markdown" }],
  read: async (path) => ({ encoding: "utf8", content: "…", mediaType: "text/markdown" }),
  write: async (path, content) => { /* presence enables editing */ },
  remove: async (path) => { /* presence enables delete */ },
};

<FileBrowserPanel source={source} initialPath="/README.md" />`}
  >
    <FileBrowserPanel source={createMemorySource()} initialPath="/README.md" class="h-96" />
  </DemoCard>
);

export const FileBrowserReadOnlyDemo = () => (
  <DemoCard
    id="file-browser-readonly"
    chip={{ kind: "component", name: "FileBrowserPanel", from: FROM_UI }}
    variant="read-only source"
    description="Without write/remove/rename on the source the same browser is a pure viewer — no edit pencil, no context-menu mutations, no add menu."
    code={`const source: FileSource = { list, read }; // no write/remove/rename/upload

<FileBrowserPanel source={source} initialPath="/README.md" />`}
  >
    <FileBrowserPanel source={createMemorySource({ readOnly: true })} initialPath="/README.md" class="h-80" />
  </DemoCard>
);

export const FileBrowserDialogDemo = () => {
  const source = createMemorySource();

  return (
    <DemoCard
      id="file-browser-dialog"
      chip={{ kind: "component", name: "openFileBrowser", from: FROM_UI }}
      variant="dialog launcher"
      description="The launcher uses the same FileBrowserPanel inside the shared dialog system. Use it when files are a secondary workflow instead of the page's primary workspace."
      code={`await openFileBrowser({
  source,
  title: "Project files",
  subtitle: "Browse and edit the in-memory demo files.",
  icon: "ti ti-folder",
});`}
    >
      <button
        type="button"
        class="btn-primary btn-sm"
        onClick={() =>
          void openFileBrowser({
            source,
            title: "Project files",
            subtitle: "Browse and edit the in-memory demo files.",
            icon: "ti ti-folder",
          })
        }
      >
        <i class="ti ti-folder-open" aria-hidden="true" />
        Open file browser
      </button>
    </DemoCard>
  );
};
