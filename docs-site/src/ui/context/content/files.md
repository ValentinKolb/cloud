# File browser

`FileBrowserPanel`, `FileTree`, and `FileView` present application-owned file
data. They do not depend on Cloud storage, routes, permissions, or mutation
APIs.

## Use file components

Use `FileBrowserPanel` for the ready tree-and-preview composition over a
`FileSource`. Use `FileTree` for a different layout or selection flow. Use
`FileView` when a page already owns the selected file.

## Import

```tsx
import {
  FileBrowserPanel,
  FileTree,
  FileView,
  canPreviewFile,
  formatFileViewSize,
  getFileViewPreviewKind,
  openFileBrowser,
  registerFileViewRenderer,
  type FileBrowserPanelProps,
  type FileSource,
  type FileTreeActions,
  type FileTreeEntry,
  type FileTreeProps,
  type FileViewContent,
  type FileViewFile,
  type FileViewPreviewKind,
  type FileViewProps,
  type FileViewRenderer,
  type FileViewRendererProps,
} from "@k2b/ui";
```

## FileSource

`FileSource` is the asynchronous boundary:

```ts
type FileSource = {
  list(): Promise<FileTreeEntry[]>;
  read(path: string): Promise<FileViewContent>;
  write?(path: string, content: string, encoding?: "utf8" | "base64"):
    Promise<void>;
  remove?(path: string): Promise<void>;
  rename?(from: string, to: string): Promise<void>;
  upload?(dirPath: string, files: File[]): Promise<void>;
  downloadHref?(path: string): string | null;
  isReadOnly?(path: string): boolean;
};
```

Only supplied capabilities receive matching controls. `readOnly` on
`FileBrowserPanel` hides every mutation even when the source implements it.
`isReadOnly` can protect individual paths such as generated inputs.
Capabilities are independent: for example, a source may offer `rename` or
`remove` without offering `write`.

The host authenticates every operation and checks authorization again inside
the source. Hiding a control is not an authorization boundary.

## Path-first tree

Each `FileTreeEntry` has an absolute-style path such as `/src/app.tsx`.
Folders are derived from file paths; explicit `{ path, kind: "folder" }`
entries represent empty folders.

`selectedPath` and `onSelect` own selection. `expandedPaths` and
`onExpandedChange` provide controlled expansion; otherwise folders start
expanded. `FileTreeActions` enables rename, remove, create, move, and download
affordances individually.

`contextMenu` adds application-specific menu items without replacing the
built-in actions.

## File previews

`FileView` receives a `FileViewFile`, an asynchronous `load` function, and
optional preview and download URLs. Text, Markdown, JSON, delimited text,
images, PDF, audio, and video use built-in renderers. Supplying `save` enables
editing for compatible text renderers.

Pass `revision` to refetch a `FileView` whose path did not change. A
`FileBrowserPanel` forwards its `refreshKey` to both the file list and the
selected preview.

Markdown files edit through `MarkdownEditor`. Other UTF-8 source and text files
use a plain monospace textarea inside the same editor chrome, so Markdown
formatting controls and completions are not offered for code.

`FileViewContent` is either UTF-8 or base64:

```ts
type FileViewContent = {
  encoding: "utf8" | "base64";
  content: string;
  mediaType: string;
};
```

`getFileViewPreviewKind` returns the inferred `FileViewPreviewKind`.
`canPreviewFile` also checks the built-in size limits.
`formatFileViewSize` produces the compact size label used by the preview.

`registerFileViewRenderer` adds an application-specific renderer before the
built-ins. Register stable renderers during application startup, not while a
component renders.

## Dialog helper

`openFileBrowser({ source, title, subtitle, icon })` opens the shared panel in
a dialog and resolves when it closes. The supplied source has the same
capability and authorization responsibilities as an inline panel.

## Accessibility

`FileTree` exposes tree and tree-item roles with arrow-key navigation.
Selection, expansion, context actions, preview actions, and text editing
remain keyboard reachable.

## Runtime

The static tree and preview shells render on the server. Resource loading,
selection, editing, drag and drop, media controls, prompts, and dialogs
require hydration.

## Example

```tsx
const entries = (): FileTreeEntry[] =>
  Object.entries(contentByPath).map(([path, content]) => ({
    path,
    mediaType: path.endsWith(".md") ? "text/markdown" : "text/plain",
    size: new TextEncoder().encode(content).byteLength,
  }));

const source: FileSource = {
  list: async () => entries(),
  read: async (path) => ({
    encoding: "utf8",
    content: contentByPath[path] ?? "",
    mediaType: path.endsWith(".md") ? "text/markdown" : "text/plain",
  }),
  write: async (path, content) => {
    contentByPath[path] = content;
  },
  rename: async (from, to) => {
    contentByPath[to] = contentByPath[from] ?? "";
    delete contentByPath[from];
  },
  remove: async (path) => {
    delete contentByPath[path];
  },
};

<FileBrowserPanel source={source} initialPath="/README.md" />;
```

## Direct composition

```tsx
<FileTree
  entries={entries()}
  selectedPath={selectedPath()}
  onSelect={(entry) => setSelectedPath(entry.path)}
/>

<FileView
  file={{ path: selectedPath(), mediaType: "text/plain" }}
  load={() => source.read(selectedPath())}
  save={(content) => source.write!(selectedPath(), content)}
/>
```
